const { SlashCommandBuilder } = require('discord.js');
const { getQueue } = require('../utils/musicQueue');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('skip')
    .setDescription('Skip the current song'),

  async execute(interaction) {
    const queue = getQueue(interaction.guildId);
    if (!queue || !queue.songs.length) {
      await interaction.reply({ content: '❌ Nothing is playing.', ephemeral: true });
      return;
    }

    queue.player.stop();
    await interaction.reply('⏭️ Skipped.');
  },

  voice: {
    patterns: [/^(?:skip|next)(?: (?:song|track|this one|it))?$/],
    examples: ['skip'],
    async run({ guildId }) {
      const queue = getQueue(guildId);
      if (!queue?.songs.length) return '❌ Nothing is playing.';
      queue.player.stop();
      return '⏭️ Skipped.';
    },
  },
};
