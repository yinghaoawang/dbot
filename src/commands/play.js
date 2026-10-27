const { SlashCommandBuilder } = require('discord.js');
const { resolveSong } = require('../utils/songResolver');
const { getQueue, enqueueSong } = require('../utils/musicQueue');

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
      songInfo = await resolveSong(query);
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

    let started;
    try {
      ({ started } = await enqueueSong(interaction.guild, voiceChannel, interaction.channel, song));
    } catch (err) {
      await interaction.editReply(`❌ ${err.message}`);
      return;
    }

    if (started) {
      await interaction.editReply(`🎶 Loading: **${song.title}**`);
    } else {
      const queue = getQueue(interaction.guildId);
      await interaction.editReply(`✅ Added to queue: **${song.title}** (position ${queue.songs.length})`);
    }
  },
};
