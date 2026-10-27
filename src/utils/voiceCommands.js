/**
 * Voice command registry.
 *
 * Every slash command in src/commands/ can expose a voice handler by exporting
 * a `voice` property next to `data` / `execute`:
 *
 *   voice: {
 *     patterns: [/^skip$/],              // matched against normalized text (lowercase, no punctuation)
 *     examples: ['skip'],                // phrases shown to users in /listen start
 *     async run({ text, match, guildId, state }) {
 *       return '⏭️ Skipped.';            // optional string -> posted to the text channel
 *     },
 *   }
 *
 * Commands are discovered automatically, so new commands only need a `voice`
 * export to become available by voice.
 */
const fs = require('node:fs');
const path = require('node:path');

const COMMANDS_PATH = path.join(__dirname, '..', 'commands');

let cache = null;

// Loaded lazily because some command files require voiceListener, which requires this module.
function loadVoiceCommands() {
  if (cache) return cache;
  cache = [];
  for (const file of fs.readdirSync(COMMANDS_PATH).filter((f) => f.endsWith('.js'))) {
    const command = require(path.join(COMMANDS_PATH, file));
    if (command.voice?.patterns?.length && typeof command.voice.run === 'function') {
      cache.push({ name: command.data?.name ?? file, ...command.voice });
    }
  }
  return cache;
}

/**
 * Runs the first voice command whose pattern matches `text`.
 * Returns true if a command handled it.
 */
async function runVoiceCommand(text, ctx) {
  for (const command of loadVoiceCommands()) {
    for (const pattern of command.patterns) {
      const match = text.match(pattern);
      if (!match) continue;
      try {
        const reply = await command.run({ ...ctx, text, match });
        if (reply) ctx.state.textChannel?.send(reply).catch(() => {});
      } catch (err) {
        console.error(`Voice command "${command.name}" failed:`, err);
        ctx.state.textChannel?.send(`⚠️ Something went wrong running "${command.name}".`).catch(() => {});
      }
      return true;
    }
  }
  return false;
}

function getVoiceExamples() {
  return loadVoiceCommands().flatMap((command) => command.examples ?? []);
}

const SMALL_NUMBERS = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

/** Finds the first number in `text`, as digits ("50") or words ("fifty five"). Returns null if none. */
function extractNumber(text) {
  const words = text.split(' ');
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (/^\d+$/.test(word)) return Number(word);
    if (word in TENS) {
      const next = SMALL_NUMBERS[words[i + 1]];
      return TENS[word] + (next > 0 && next < 10 ? next : 0);
    }
    if (word in SMALL_NUMBERS) return words[i + 1] === 'hundred' ? SMALL_NUMBERS[word] * 100 : SMALL_NUMBERS[word];
    if (word === 'hundred') return 100;
  }
  return null;
}

module.exports = { runVoiceCommand, getVoiceExamples, extractNumber };
