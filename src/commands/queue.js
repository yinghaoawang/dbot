const { SlashCommandBuilder } = require('discord.js');
const { getQueue } = require('../utils/musicQueue');

function formatQueue(queue) {
  const list = queue.songs
    .map((song, i) => `${i === 0 ? '▶️' : `${i}.`} **${song.title}** — requested by ${song.requestedBy}`)
    .join('\n');
  return `🎵 **Current Queue:**\n${list}`;
}

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

    await interaction.reply(formatQueue(queue));
  },

  voice: {
    patterns: [/^(?:show |what s in |list )?(?:the |my )?(?:queue|playlist)$/],
    examples: ['show the queue'],
    async run({ guildId }) {
      const queue = getQueue(guildId);
      if (!queue?.songs.length) return '📭 The queue is empty.';
      return formatQueue(queue);
    },
  },
};
