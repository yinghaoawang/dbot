const { EndBehaviorType } = require('@discordjs/voice');
const prism = require('prism-media');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pcmToWav } = require('./wav');
const { transcribeWav } = require('./transcriber');
const { runVoiceCommand } = require('./voiceCommands');
const { findWakeWord } = require('./wakeWord');
const { logTranscript } = require('./transcriptLog');

const AWAITING_COMMAND_TIMEOUT_MS = 10_000;
const SILENCE_DURATION_MS = 1_000;
// Minimum bytes of PCM (48kHz, 16-bit, stereo) to bother transcribing (~0.3s)
const MIN_PCM_BYTES = 48_000 * 2 * 2 * 0.3;

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

  try {
    for await (const chunk of opusStream.pipe(decoder)) {
      chunks.push(chunk);
    }
  } catch (err) {
    console.error(`Voice capture error for user ${userId} in guild ${guildId}:`, err);
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
  try {
    const wavBuffer = pcmToWav(pcmData);
    fs.writeFileSync(wavPath, wavBuffer);
    transcript = (await transcribeWav(wavPath)).trim();
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

  console.log(`[voice:${guildId}] ${userId} heard: "${transcript}"`);
  logTranscript({ guild: state.guild, voiceChannel: state.voiceChannel, userId, text: transcript });
  if (process.env.VOICE_DEBUG) {
    state.textChannel?.send(`🗣️ Heard: "${transcript}"`).catch(() => {});
  }

  const normalized = normalizeTranscript(transcript);

  if (state.awaitingCommand) {
    if (state.awaitingTimeout) clearTimeout(state.awaitingTimeout);
    state.awaitingCommand = false;
    await processCommand(guildId, state, normalized);
    return;
  }

  const wakeMatch = findWakeWord(normalized);
  if (!wakeMatch) return;

  const after = wakeMatch.after;
  if (after.length > 0) {
    await processCommand(guildId, state, after);
  } else {
    state.awaitingCommand = true;
    state.textChannel?.send('🎤 Listening... what should I do?').catch(() => {});
    state.awaitingTimeout = setTimeout(() => {
      state.awaitingCommand = false;
    }, AWAITING_COMMAND_TIMEOUT_MS);
  }
}

async function processCommand(guildId, state, text) {
  const handled = await runVoiceCommand(text, { guildId, state });
  if (!handled) {
    state.textChannel?.send(`❓ Didn't recognize that command: "${text}"`).catch(() => {});
  }
}

module.exports = { startListening, stopListening, isListening };
