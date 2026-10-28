const { SlashCommandBuilder } = require('discord.js');
const { getQueue, speak } = require('../utils/musicQueue');
const { askBrief } = require('../utils/llm');

/** Question line on top, answer underneath. */
function formatReply(question, answer) {
  return `❓ **${question}**\n💬 ${answer}`;
}

/** Voice transcripts are normalized (lowercase, no punctuation, "what s"); make them read like a question. */
function prettifySpokenQuestion(text) {
  const cleaned = text.replace(/\b(\w+) s\b/g, "$1's").replace(/\s+/g, ' ').trim();
  const capitalized = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  return /[?.!]$/.test(capitalized) ? capitalized : `${capitalized}?`;
}

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
      const question = interaction.options.getString('question', true);
      const answer = await answerAndSpeak(interaction.guildId, question);
      await interaction.editReply(formatReply(question, answer));
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
      if (!question) return '❓ Say it in one go: "hey diddy bot, I have a question: ..."';
      try {
        return formatReply(prettifySpokenQuestion(question), await answerAndSpeak(guildId, question));
      } catch (err) {
        console.error('Voice question failed:', err);
        return `⚠️ ${err.message}`;
      }
    },
  },
};
