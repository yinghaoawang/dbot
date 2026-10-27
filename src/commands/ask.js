const { SlashCommandBuilder } = require('discord.js');
const { getQueue, speak } = require('../utils/musicQueue');
const { askBrief } = require('../utils/llm');

async function answerAndSpeak(guildId, question) {
  const answer = await askBrief(question);
  // Speak only if the bot is in a voice channel; otherwise the text answer is all there is.
  if (getQueue(guildId)) {
    await speak(guildId, answer).catch((err) => console.error('Failed to speak answer:', err));
  }
  return answer;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ask')
    .setDescription('Ask Diddy a question and get a brief answer')
    .addStringOption((option) =>
      option.setName('question').setDescription('Your question').setRequired(true).setMaxLength(500)
    ),

  async execute(interaction) {
    await interaction.deferReply();
    try {
      const answer = await answerAndSpeak(interaction.guildId, interaction.options.getString('question', true));
      await interaction.editReply(`💬 ${answer}`);
    } catch (err) {
      console.error('Ask command failed:', err);
      await interaction.editReply(`⚠️ ${err.message}`);
    }
  },

  voice: {
    patterns: [
      /^(?:i have|i ve got|ive got|i got|got) (?:a |one )?(?:quick )?question (.+)$/,
      /^(?:i have|i ve got|ive got|i got|got) (?:a |one )?(?:quick )?question$/,
    ],
    examples: ['I have a question: what is the tallest mountain'],
    async run({ guildId, match }) {
      const question = match[1];
      if (!question) return '❓ Say it in one go: "hey diddy, I have a question: ..."';
      try {
        return `💬 ${await answerAndSpeak(guildId, question)}`;
      } catch (err) {
        console.error('Voice question failed:', err);
        return `⚠️ ${err.message}`;
      }
    },
  },
};
