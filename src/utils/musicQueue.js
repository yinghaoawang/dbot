const {
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
  StreamType,
} = require('@discordjs/voice');
const youtubedl = require('yt-dlp-exec');
const { spawn } = require('node:child_process');
const ffmpegPath = require('ffmpeg-static');

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
 * @property {import('child_process').ChildProcess | null} currentProcess
 * @property {import('child_process').ChildProcess | null} currentFfmpeg
 */

/** @type {Map<string, GuildQueue>} */
const queues = new Map();

function getQueue(guildId) {
  return queues.get(guildId);
}

function createQueue(guildId, connection, textChannel) {
  const player = createAudioPlayer();
  /** @type {GuildQueue} */
  const queue = { connection, player, songs: [], textChannel, playing: false, currentProcess: null, currentFfmpeg: null };
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

    const resource = createAudioResource(ffmpeg.stdout, {
      inputType: StreamType.Raw,
      inlineVolume: true,
    });
    resource.volume?.setVolume(1);
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

module.exports = {
  queues,
  getQueue,
  createQueue,
  playNext,
  destroyQueue,
};
