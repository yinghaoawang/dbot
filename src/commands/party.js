const { SlashCommandBuilder } = require('discord.js');
const { ensureQueue, speak } = require('../utils/musicQueue');
const { getDiddyChannel } = require('../utils/diddyChannel');

const RESPONSE = 'Hell yeah!';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('party')
    .setDescription('Ask the bot if we can have a party'),

  async execute(interaction) {
    const voiceChannel = interaction.member?.voice?.channel;
    if (!voiceChannel) {
      await interaction.reply({
        content: '❌ You need to be in a voice channel to party.',
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply();
    try {
      await ensureQueue(interaction.guild, voiceChannel, getDiddyChannel(interaction.guild));
      await interaction.editReply('🎉');
      await speak(interaction.guildId, RESPONSE);
    } catch (err) {
      console.error('Party command failed:', err);
      await interaction.editReply(`❌ ${err.message}`);
    }
  },

  voice: {
    patterns: [
      /^(?:can|could|may) we (?:please )?(?:have|throw|start|get) (?:a|the) party$/,
      /^(?:let s|lets) (?:have a |throw a )?party$/,
      /^party time$/,
    ],
    examples: ['can we have a party'],
    async run({ guildId }) {
      // Spoken only; nothing is posted to text.
      await speak(guildId, RESPONSE);
    },
  },
};
