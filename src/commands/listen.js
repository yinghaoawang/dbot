const { SlashCommandBuilder } = require('discord.js');
const { ensureQueue } = require('../utils/musicQueue');
const { startListening, stopListening, isListening } = require('../utils/voiceListener');
const { getVoiceExamples } = require('../utils/voiceCommands');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('listen')
    .setDescription('Enable or disable voice command listening ("hey diddy")')
    .addSubcommand((sub) => sub.setName('start').setDescription('Start listening for voice commands'))
    .addSubcommand((sub) => sub.setName('stop').setDescription('Stop listening for voice commands')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const member = interaction.member;
    const voiceChannel = member?.voice?.channel;

    if (sub === 'stop') {
      if (!isListening(interaction.guildId)) {
        await interaction.reply({ content: '❌ I\'m not currently listening.', ephemeral: true });
        return;
      }
      stopListening(interaction.guildId);
      interaction.guild.members.me?.voice?.setDeaf(true).catch(() => {});
      await interaction.reply('🔇 Stopped listening for voice commands.');
      return;
    }

    // sub === 'start'
    if (!voiceChannel) {
      await interaction.reply({
        content: '❌ You need to be in a voice channel for me to listen.',
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

    if (isListening(interaction.guildId)) {
      await interaction.reply({ content: '❌ Already listening for voice commands.', ephemeral: true });
      return;
    }

    await interaction.deferReply();

    let queue;
    try {
      queue = await ensureQueue(interaction.guild, voiceChannel, interaction.channel);
    } catch (err) {
      await interaction.editReply(`❌ ${err.message}`);
      return;
    }

    // Receiving audio requires the bot to not be self-deafened.
    try {
      await interaction.guild.members.me?.voice?.setDeaf(false);
    } catch (err) {
      console.error('Failed to undeafen bot:', err);
    }

    startListening(interaction.guildId, queue.connection, voiceChannel, interaction.channel, interaction.guild);

    const examples = getVoiceExamples().map((e) => `**${e}**`).join(', ');
    await interaction.editReply(
      `🎤 Listening for voice commands! Say **"hey diddy"** then a command like ${examples}.`
    );
  },

  voice: {
    patterns: [/^(?:stop|disable) listening$/],
    examples: ['stop listening'],
    async run({ guildId, state }) {
      stopListening(guildId);
      state.guild.members.me?.voice?.setDeaf(true).catch(() => {});
      return '🔇 Stopped listening for voice commands.';
    },
  },
};
