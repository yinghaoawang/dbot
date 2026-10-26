const { SlashCommandBuilder } = require('discord.js');
const { getQueue } = require('../utils/musicQueue');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('remove')
    .setDescription('Remove a song from the queue')
    .addIntegerOption((option) =>
      option
        .setName('position')
        .setDescription('Position in the queue to remove (see /queue, 1 = next up)')
        .setRequired(true)
        .setMinValue(1)
    ),

  async execute(interaction) {
    const queue = getQueue(interaction.guildId);
    if (!queue || !queue.songs.length) {
      await interaction.reply({ content: '📭 The queue is empty.', ephemeral: true });
      return;
    }

    const position = interaction.options.getInteger('position', true);

    if (position === 1) {
      await interaction.reply({
        content: '❌ Can\'t remove the currently playing song. Use `/skip` instead.',
        ephemeral: true,
      });
      return;
    }

    const index = position - 1;
    if (index < 0 || index >= queue.songs.length) {
      await interaction.reply({ content: `❌ Invalid position. The queue has ${queue.songs.length} song(s).`, ephemeral: true });
      return;
    }

    const [removed] = queue.songs.splice(index, 1);
    await interaction.reply(`🗑️ Removed **${removed.title}** from the queue.`);
  },
};
