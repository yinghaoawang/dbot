const { EndBehaviorType } = require('@discordjs/voice');
const prism = require('prism-media');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pipeline } = require('node:stream');
const { pcmToWav } = require('./wav');
const { transcribeWav } = require('./transcriber');
const { runVoiceCommand } = require('./voiceCommands');
const { findWakeWord } = require('./wakeWord');
const { logTranscript } = require('./transcriptLog');

const AWAITING_COMMAND_TIMEOUT_MS = 10_000;
const SILENCE_DURATION_MS = 1_250;
// Minimum bytes of PCM (48kHz, 16-bit, stereo) to bother transcribing (~0.3s)
const MIN_PCM_BYTES = 48_000 * 2 * 2 * 0.3;
// Whisper invents short common phrases ("pause", "thank you") on near-silence, often
// with deceptively good scores. Require the clip carrying the wake word to clear
// these bars, otherwise a hallucination can trigger "hey diddy ..." out of nowhere.
const WAKE_MAX_NO_SPEECH_PROB = 0.4;
const WAKE_MIN_AVG_LOGPROB = -0.8;
// Minimum gap between attempts to repair the end-to-end encryption session.
const DAVE_RECOVERY_COOLDOWN_MS = 10_000;

/**
 * After a DAVE decrypt failure, @discordjs/voice keeps throwing on every packet
 * from that user and (when no transition has happened yet) never recovers on its
 * own, so nobody is heard until the bot restarts. Ask Discord to redo the key
 * exchange using the library's own recovery routine.
 */
function recoverEncryption(guildId, state, err) {
  if (!/decrypt/i.test(err?.message ?? '')) return;
  const now = Date.now();
  if (now - (state.lastDaveRecovery ?? 0) < DAVE_RECOVERY_COOLDOWN_MS) return;
  state.lastDaveRecovery = now;

  const dave = state.connection.state?.networking?.state?.dave;
  if (typeof dave?.recoverFromInvalidTransition !== 'function') return;
  console.warn(`[voice:${guildId}] Voice decryption failed, asking Discord to re-establish encryption...`);
  dave.recoverFromInvalidTransition(dave.lastTransitionId ?? 0);
}

/**
 * Strips punctuation (keeping word characters and spaces) and collapses
 * whitespace, so transcripts like "Hey, Diddy. Play last night." can be
 * reliably matched regardless of how Whisper punctuates them.
 */
function normalizeTranscript(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** @type {Map<string, GuildListenState>} */
const listeners = new Map();

/**
 * @typedef {Object} GuildListenState
 * @property {import('@discordjs/voice').VoiceConnection} connection
 * @property {import('discord.js').VoiceBasedChannel} voiceChannel
 * @property {import('discord.js').TextBasedChannel} textChannel
 * @property {import('discord.js').Guild} guild
 * @property {Set<string>} activeUsers
 * @property {boolean} awaitingCommand
 * @property {NodeJS.Timeout | null} awaitingTimeout
 * @property {(userId: string) => void} speakingHandler
 */

function isListening(guildId) {
  return listeners.has(guildId);
}

function startListening(guildId, connection, voiceChannel, textChannel, guild) {
  if (listeners.has(guildId)) return listeners.get(guildId);

  /** @type {GuildListenState} */
  const state = {
    connection,
    voiceChannel,
    textChannel,
    guild,
    activeUsers: new Set(),
    awaitingCommand: false,
    awaitingTimeout: null,
    speakingHandler: null,
  };

  const speakingHandler = (userId) => {
    if (userId === guild.members.me?.id) return;
    if (state.activeUsers.has(userId)) return;
    state.activeUsers.add(userId);
    handleUtterance(guildId, state, userId).finally(() => {
      state.activeUsers.delete(userId);
    });
  };

  state.speakingHandler = speakingHandler;
  connection.receiver.speaking.on('start', speakingHandler);
  listeners.set(guildId, state);
  console.log(`[voice:${guildId}] Started listening in #${voiceChannel.name}`);
  return state;
}

function stopListening(guildId) {
  const state = listeners.get(guildId);
  if (!state) return;

  if (state.awaitingTimeout) clearTimeout(state.awaitingTimeout);
  try {
    state.connection.receiver.speaking.removeListener('start', state.speakingHandler);
  } catch {
    // ignore
  }
  listeners.delete(guildId);
  console.log(`[voice:${guildId}] Stopped listening`);
}

async function handleUtterance(guildId, state, userId) {
  console.log(`[voice:${guildId}] Capturing audio from user ${userId}...`);
  const opusStream = state.connection.receiver.subscribe(userId, {
    end: { behavior: EndBehaviorType.AfterSilence, duration: SILENCE_DURATION_MS },
  });

  const decoder = new prism.opus.Decoder({ rate: 48000, channels: 2, frameSize: 960 });
  const chunks = [];

  // pipeline (unlike .pipe) forwards errors and destroys the decoder when the
  // receive stream fails. Without an error handler, a DAVE decryption failure
  // ("DecryptionFailed") from @discordjs/voice would crash the whole process.
  pipeline(opusStream, decoder, (err) => {
    if (err) recoverEncryption(guildId, state, err);
  });

  try {
    for await (const chunk of decoder) {
      chunks.push(chunk);
    }
  } catch (err) {
    console.error(`[voice:${guildId}] Audio capture from ${userId} failed, skipping clip: ${err?.message ?? err}`);
    return;
  }

  const pcmData = Buffer.concat(chunks);
  if (pcmData.length < MIN_PCM_BYTES) {
    console.log(
      `[voice:${guildId}] Ignoring short clip from ${userId} (${pcmData.length} bytes < ${MIN_PCM_BYTES} min)`
    );
    return;
  }

  const wavPath = path.join(os.tmpdir(), `dbot-voice-${guildId}-${userId}-${Date.now()}.wav`);
  let transcript;
  let confidence;
  try {
    const wavBuffer = pcmToWav(pcmData);
    fs.writeFileSync(wavPath, wavBuffer);
    const result = await transcribeWav(wavPath);
    transcript = result.text.trim();
    confidence = { noSpeechProb: result.noSpeechProb, avgLogprob: result.avgLogprob };
  } catch (err) {
    console.error(`Transcription failed in guild ${guildId}:`, err?.message ?? err);
    return;
  } finally {
    fs.unlink(wavPath, () => {});
  }

  if (!transcript) {
    console.log(`[voice:${guildId}] ${userId} said nothing recognizable (empty transcript)`);
    return;
  }

  const stats = (n) => (n == null ? '?' : n.toFixed(2));
  console.log(
    `[voice:${guildId}] ${userId} heard: "${transcript}" ` +
      `(no_speech ${stats(confidence.noSpeechProb)}, logprob ${stats(confidence.avgLogprob)})`
  );
  logTranscript({ guild: state.guild, voiceChannel: state.voiceChannel, userId, text: transcript });
  if (process.env.VOICE_DEBUG) {
    state.textChannel?.send(`🗣️ Heard: "${transcript}"`).catch(() => {});
  }

  const normalized = normalizeTranscript(transcript);

  if (state.awaitingCommand) {
    if (state.awaitingTimeout) clearTimeout(state.awaitingTimeout);
    state.awaitingCommand = false;
    runCommand(guildId, state, normalized, confidence);
    return;
  }

  const wakeMatch = findWakeWord(normalized);
  if (!wakeMatch) return;

  // A clip containing the wake word must be a confident transcription; low-confidence
  // ones are usually Whisper hallucinating the wake phrase on background noise.
  if (
    (confidence.noSpeechProb != null && confidence.noSpeechProb > WAKE_MAX_NO_SPEECH_PROB) ||
    (confidence.avgLogprob != null && confidence.avgLogprob < WAKE_MIN_AVG_LOGPROB)
  ) {
    console.log(`[voice:${guildId}] Ignoring low-confidence wake word in "${transcript}"`);
    return;
  }

  const after = wakeMatch.after;
  if (after.length > 0) {
    runCommand(guildId, state, after, confidence);
  } else {
    state.awaitingCommand = true;
    state.textChannel?.send('🎤 Listening... what should I do?').catch(() => {});
    state.awaitingTimeout = setTimeout(() => {
      state.awaitingCommand = false;
    }, AWAITING_COMMAND_TIMEOUT_MS);
  }
}

/**
 * Runs a command without awaiting it. The user stays "busy" (ignored) only while
 * their audio is captured and transcribed, so a slow or stuck command (a long
 * spoken answer, a stalled playback) can never stop the bot from hearing them.
 */
function runCommand(guildId, state, text, confidence) {
  processCommand(guildId, state, text, confidence).catch((err) => {
    console.error(`[voice:${guildId}] Command "${text}" failed:`, err);
  });
}

async function processCommand(guildId, state, text, confidence) {
  const handled = await runVoiceCommand(text, { guildId, state, confidence });
  if (!handled) {
    state.textChannel?.send(`❓ Didn't recognize that command: "${text}"`).catch(() => {});
  }
}

module.exports = { startListening, stopListening, isListening };
