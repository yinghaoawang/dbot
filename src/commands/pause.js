const { SlashCommandBuilder } = require('discord.js');
const { getQueue } = require('../utils/musicQueue');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('pause')
    .setDescription('Pause the current song'),

  async execute(interaction) {
    const queue = getQueue(interaction.guildId);
    if (!queue || !queue.playing) {
      await interaction.reply({ content: '❌ Nothing is playing.', ephemeral: true });
      return;
    }

    queue.player.pause();
    await interaction.reply('⏸️ Paused.');
  },

  voice: {
    patterns: [/^pause(?: (?:song|music|it|playback))?$/],
    examples: ['pause'],
    async run({ guildId }) {
      const queue = getQueue(guildId);
      if (!queue?.playing) return '❌ Nothing is playing.';
      queue.player.pause();
      return '⏸️ Paused.';
    },
  },
};
