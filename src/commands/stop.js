const { SlashCommandBuilder } = require('discord.js');
const { getQueue, destroyQueue } = require('../utils/musicQueue');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('stop')
    .setDescription('Stop playback and clear the queue, and leave the voice channel'),

  async execute(interaction) {
    const queue = getQueue(interaction.guildId);
    if (!queue) {
      await interaction.reply({ content: '❌ Nothing is playing.', ephemeral: true });
      return;
    }

    queue.songs = [];
    destroyQueue(interaction.guildId);
    await interaction.reply('⏹️ Stopped playback and left the voice channel.');
  },
};
