const { SlashCommandBuilder } = require('discord.js');
const { getQueue } = require('../utils/musicQueue');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('queue')
    .setDescription('Show the current song queue'),

  async execute(interaction) {
    const queue = getQueue(interaction.guildId);
    if (!queue || !queue.songs.length) {
      await interaction.reply({ content: '📭 The queue is empty.', ephemeral: true });
      return;
    }

    const list = queue.songs
      .map((song, i) => `${i === 0 ? '▶️' : `${i}.`} **${song.title}** — requested by ${song.requestedBy}`)
      .join('\n');

    await interaction.reply(`🎵 **Current Queue:**\n${list}`);
  },
};
