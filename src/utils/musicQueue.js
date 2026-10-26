const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
  StreamType,
} = require('@discordjs/voice');
const play = require('play-dl');

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
 */

/** @type {Map<string, GuildQueue>} */
const queues = new Map();

function getQueue(guildId) {
  return queues.get(guildId);
}

function createQueue(guildId, connection, textChannel) {
  const player = createAudioPlayer();
  /** @type {GuildQueue} */
  const queue = { connection, player, songs: [], textChannel, playing: false };
  queues.set(guildId, queue);

  connection.subscribe(player);

  player.on(AudioPlayerStatus.Idle, () => {
    queue.songs.shift();
    playNext(guildId);
  });

  player.on('error', (error) => {
    console.error(`Audio player error in guild ${guildId}:`, error);
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

async function playNext(guildId) {
  const queue = getQueue(guildId);
  if (!queue) return;

  const nextSong = queue.songs[0];
  if (!nextSong) {
    queue.playing = false;
    return;
  }

  try {
    const stream = await play.stream(nextSong.url);
    const resource = createAudioResource(stream.stream, {
      inputType: stream.type ?? StreamType.Arbitrary,
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
