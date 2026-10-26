const { SlashCommandBuilder } = require('discord.js');
const { joinVoiceChannel } = require('@discordjs/voice');
const play = require('play-dl');
const { getQueue, createQueue, playNext } = require('../utils/musicQueue');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('Play a song from YouTube (by URL or search terms)')
    .addStringOption((option) =>
      option
        .setName('query')
        .setDescription('YouTube URL or search terms')
        .setRequired(true)
    ),

  async execute(interaction) {
    const member = interaction.member;
    const voiceChannel = member?.voice?.channel;

    if (!voiceChannel) {
      await interaction.reply({
        content: '❌ You need to be in a voice channel to play music.',
        ephemeral: true,
      });
      return;
    }

    const permissions = voiceChannel.permissionsFor(interaction.client.user);
    if (!permissions?.has('Connect') || !permissions.has('Speak')) {
      await interaction.reply({
        content: '❌ I need permission to join and speak in your voice channel.',
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply();

    const query = interaction.options.getString('query', true);
    let songInfo;

    try {
      if (play.yt_validate(query) === 'video') {
        const info = await play.video_info(query);
        songInfo = { title: info.video_details.title, url: info.video_details.url };
      } else {
        const results = await play.search(query, { limit: 1, source: { youtube: 'video' } });
        if (!results.length) {
          await interaction.editReply('❌ No results found for that search.');
          return;
        }
        songInfo = { title: results[0].title, url: results[0].url };
      }
    } catch (err) {
      console.error('Search/lookup failed:', err);
      await interaction.editReply('❌ Failed to find that song.');
      return;
    }

    const song = {
      title: songInfo.title,
      url: songInfo.url,
      requestedBy: interaction.user.tag,
    };

    let queue = getQueue(interaction.guildId);

    if (!queue) {
      const connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: interaction.guildId,
        adapterCreator: interaction.guild.voiceAdapterCreator,
        selfDeaf: true,
      });
      queue = createQueue(interaction.guildId, connection, interaction.channel);
    }

    queue.songs.push(song);

    if (!queue.playing) {
      await interaction.editReply(`🎶 Loading: **${song.title}**`);
      playNext(interaction.guildId);
    } else {
      await interaction.editReply(`✅ Added to queue: **${song.title}** (position ${queue.songs.length})`);
    }
  },
};
