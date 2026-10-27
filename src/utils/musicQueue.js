const {
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
  StreamType,
  joinVoiceChannel,
} = require('@discordjs/voice');
const youtubedl = require('yt-dlp-exec');
const { spawn } = require('node:child_process');
const { Readable } = require('node:stream');
const ffmpegPath = require('ffmpeg-static');
const volumeStore = require('./volumeStore');
const tts = require('./tts');
const { OverlayMixer } = require('./overlayMixer');

/**
 * @typedef {Object} Song
 * @property {string} title
 * @property {string} url
 * @property {string} requestedBy
 */

/**
 * @typedef {Object} GuildQueue
 * @property {import('@discordjs/voice').VoiceConnection} connection
 * @property {import('@discordjs/voice').AudioPlayer} player
 * @property {Song[]} songs
 * @property {import('discord.js').TextBasedChannel} textChannel
 * @property {boolean} playing
 * @property {number} volume
 * @property {import('child_process').ChildProcess | null} currentProcess
 * @property {import('child_process').ChildProcess | null} currentFfmpeg
 * @property {OverlayMixer | null} mixer
 */

const DEFAULT_VOLUME = 1;

/** @type {Map<string, GuildQueue>} */
const queues = new Map();

function getQueue(guildId) {
  return queues.get(guildId);
}

function createQueue(guildId, connection, textChannel) {
  const player = createAudioPlayer();
  /** @type {GuildQueue} */
  const queue = {
    connection,
    player,
    songs: [],
    textChannel,
    playing: false,
    volume: volumeStore.get(guildId) ?? DEFAULT_VOLUME,
    currentProcess: null,
    currentFfmpeg: null,
    mixer: null,
  };
  queues.set(guildId, queue);

  connection.subscribe(player);

  player.on(AudioPlayerStatus.Idle, () => {
    killCurrentProcess(queue);
    queue.songs.shift();
    playNext(guildId);
  });

  player.on('error', (error) => {
    console.error(`Audio player error in guild ${guildId}:`, error);
    killCurrentProcess(queue);
    queue.songs.shift();
    playNext(guildId);
  });

  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    try {
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
      ]);
    } catch {
      destroyQueue(guildId);
    }
  });

  return queue;
}

function killCurrentProcess(queue) {
  if (queue.currentProcess && !queue.currentProcess.killed) {
    queue.currentProcess.kill();
  }
  queue.currentProcess = null;

  if (queue.currentFfmpeg && !queue.currentFfmpeg.killed) {
    queue.currentFfmpeg.kill();
  }
  queue.currentFfmpeg = null;
  queue.mixer = null;
}

async function playNext(guildId) {
  const queue = getQueue(guildId);
  if (!queue) return;

  const nextSong = queue.songs[0];
  if (!nextSong) {
    queue.playing = false;
    return;
  }

  try {
    const subprocess = youtubedl.exec(
      nextSong.url,
      {
        output: '-',
        format: 'bestaudio/best',
        noPlaylist: true,
        noWarnings: true,
        quiet: true,
      },
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );

    queue.currentProcess = subprocess;

    subprocess.catch((err) => {
      if (!err?.isCanceled && !err?.killed) {
        console.error('yt-dlp process error:', err?.shortMessage ?? err);
      }
    });
    subprocess.stderr?.on('data', () => {});

    const ffmpeg = spawn(
      ffmpegPath,
      [
        '-analyzeduration', '0',
        '-loglevel', 'error',
        '-i', 'pipe:0',
        '-f', 's16le',
        '-ar', '48000',
        '-ac', '2',
        'pipe:1',
      ],
      { stdio: ['pipe', 'pipe', 'pipe'] }
    );

    queue.currentFfmpeg = ffmpeg;

    subprocess.stdout.pipe(ffmpeg.stdin);
    subprocess.stdout.on('error', () => {});
    ffmpeg.stdin.on('error', () => {});
    ffmpeg.stderr.on('data', (data) => {
      console.error('ffmpeg:', data.toString());
    });
    ffmpeg.on('error', (err) => {
      console.error('ffmpeg process error:', err);
    });

    // The mixer lets announcements (TTS) play over the music without pausing it.
    const mixer = new OverlayMixer();
    ffmpeg.stdout.pipe(mixer);
    ffmpeg.stdout.on('error', () => {});
    mixer.on('error', () => {});
    queue.mixer = mixer;

    const resource = createAudioResource(mixer, {
      inputType: StreamType.Raw,
      inlineVolume: true,
    });
    resource.volume?.setVolume(queue.volume);
    queue.player.play(resource);
    queue.playing = true;
    queue.textChannel?.send(`🎶 Now playing: **${nextSong.title}**`).catch(() => {});
  } catch (err) {
    console.error('Failed to play song:', err);
    queue.textChannel?.send(`⚠️ Failed to play **${nextSong.title}**, skipping.`).catch(() => {});
    queue.songs.shift();
    playNext(guildId);
  }
}

function destroyQueue(guildId) {
  const queue = getQueue(guildId);
  if (!queue) return;
  try {
    killCurrentProcess(queue);
    queue.player.stop();
    queue.connection.destroy();
  } catch {
    // ignore
  }
  queues.delete(guildId);
}

function setVolume(guildId, volume) {
  const clamped = Math.min(Math.max(volume, 0), 2);
  volumeStore.set(guildId, clamped);

  const queue = getQueue(guildId);
  if (queue) {
    queue.volume = clamped;
    const resource = queue.player.state.resource;
    resource?.volume?.setVolume(clamped);
  }

  return clamped;
}

function getPendingOrCurrentVolume(guildId) {
  const queue = getQueue(guildId);
  if (queue) return queue.volume;
  return volumeStore.get(guildId) ?? DEFAULT_VOLUME;
}

/**
 * Ensures a voice connection + queue exists for the guild, joining the given
 * voice channel if necessary. Returns the existing or newly created queue.
 */
async function ensureQueue(guild, voiceChannel, textChannel) {
  let queue = getQueue(guild.id);
  if (queue) return queue;

  const connection = joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId: guild.id,
    adapterCreator: guild.voiceAdapterCreator,
    selfDeaf: true,
  });

  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
  } catch (err) {
    connection.destroy();
    throw new Error('Failed to join the voice channel in time.');
  }

  queue = createQueue(guild.id, connection, textChannel);
  return queue;
}

/**
 * Adds a resolved song ({ title, url, requestedBy }) to the guild's queue,
 * joining the voice channel if needed, and starts playback if idle.
 * Returns { queue, started } where started indicates playback began immediately.
 */
async function enqueueSong(guild, voiceChannel, textChannel, song) {
  const queue = await ensureQueue(guild, voiceChannel, textChannel);
  queue.songs.push(song);

  const started = !queue.playing;
  if (started) {
    playNext(guild.id);
  }

  return { queue, started };
}

/**
 * Speaks `text` in the guild's voice channel using TTS. If music is playing the
 * speech is mixed on top of it (music ducked, never paused); otherwise it plays
 * on its own. Requires an existing queue (voice connection).
 */
async function speak(guildId, text) {
  const queue = getQueue(guildId);
  if (!queue) throw new Error('Not connected to a voice channel.');

  const pcm = await tts.decodeToBuffer(await tts.synthesize(text), 3); // boost volume by 3x

  // Re-check after the awaits: the song/queue may have changed meanwhile.
  if (getQueue(guildId) !== queue) return;
  if (queue.mixer && queue.player.state.status === AudioPlayerStatus.Playing) {
    await queue.mixer.playOverlay(pcm);
    return;
  }

  // Nothing playing (or paused): use a temporary player for the announcement.
  const announcer = createAudioPlayer();
  const finished = new Promise((resolve) => {
    announcer.on('stateChange', (_old, next) => {
      if (next.status === AudioPlayerStatus.Idle) resolve();
    });
    announcer.on('error', (err) => {
      console.error('TTS player error:', err);
      resolve();
    });
  });

  queue.connection.subscribe(announcer);
  announcer.play(createAudioResource(Readable.from([pcm]), { inputType: StreamType.Raw }));

  try {
    await finished;
  } finally {
    // The queue may have been destroyed (e.g. "stop") while speaking.
    if (getQueue(guildId) === queue) queue.connection.subscribe(queue.player);
  }
}

module.exports = {
  queues,
  getQueue,
  createQueue,
  playNext,
  destroyQueue,
  setVolume,
  getPendingOrCurrentVolume,
  ensureQueue,
  enqueueSong,
  speak,
  DEFAULT_VOLUME,
};
