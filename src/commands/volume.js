const { SlashCommandBuilder } = require('discord.js');
const { getQueue, setVolume, getPendingOrCurrentVolume } = require('../utils/musicQueue');
const { extractNumber } = require('../utils/voiceCommands');

const STEP = 0.1; // 10%

function applyVolume(guildId, newVolume) {
  const applied = setVolume(guildId, newVolume);
  const suffix = getQueue(guildId) ? '' : ' (will apply when playback starts)';
  return `🔊 Volume set to **${Math.round(applied * 100)}%**${suffix}`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('volume')
    .setDescription('Adjust the playback volume')
    .addSubcommand((sub) =>
      sub
        .setName('set')
        .setDescription('Set the volume to a specific percentage')
        .addIntegerOption((option) =>
          option
            .setName('percent')
            .setDescription('Volume percentage (0-200)')
            .setRequired(true)
            .setMinValue(0)
            .setMaxValue(200)
        )
    )
    .addSubcommand((sub) => sub.setName('up').setDescription('Raise the volume by 10%'))
    .addSubcommand((sub) => sub.setName('down').setDescription('Lower the volume by 10%')),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    let newVolume = getPendingOrCurrentVolume(interaction.guildId);

    if (subcommand === 'set') {
      const percent = interaction.options.getInteger('percent', true);
      newVolume = percent / 100;
    } else if (subcommand === 'up') {
      newVolume += STEP;
    } else if (subcommand === 'down') {
      newVolume -= STEP;
    }

    await interaction.reply(applyVolume(interaction.guildId, newVolume));
  },

  voice: {
    patterns: [
      /^(?:set |change )?(?:the )?volume(?: (.+))?$/,
      /^(?:louder|quieter|turn (?:it )?(?:up|down))$/,
    ],
    examples: ['volume 50', 'volume up', 'volume down'],
    async run({ guildId, text }) {
      const current = getPendingOrCurrentVolume(guildId);
      if (/\b(?:up|louder|raise|increase)\b/.test(text)) return applyVolume(guildId, current + STEP);
      if (/\b(?:down|quieter|lower|decrease)\b/.test(text)) return applyVolume(guildId, current - STEP);

      const percent = extractNumber(text);
      if (percent === null) return `🔊 Volume is **${Math.round(current * 100)}%**.`;
      return applyVolume(guildId, percent / 100);
    },
  },
};
