const { SlashCommandBuilder } = require('discord.js');
const { getQueue, setVolume, getPendingOrCurrentVolume } = require('../utils/musicQueue');

const STEP = 0.1; // 10%

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

    const applied = setVolume(interaction.guildId, newVolume);
    const displayPercent = Math.round(applied * 100);
    const queue = getQueue(interaction.guildId);
    const suffix = queue ? '' : ' (will apply when playback starts)';
    await interaction.reply(`🔊 Volume set to **${displayPercent}%**${suffix}`);
  },
};
