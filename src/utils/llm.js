// Asks a large language model for a short answer that can be spoken aloud.
// Works with any OpenAI-compatible chat completions API (OpenAI, OpenRouter,
// Groq, a local Ollama at http://localhost:11434/v1, ...). Configure with env:
//   LLM_MODEL     (required) model name
//   LLM_API_KEY   API key (not needed for local servers)
//   LLM_BASE_URL  default https://api.openai.com/v1
//   LLM_MAX_WORDS default 34 (about 11 seconds with the en_US-joe-medium voice)

const MAX_WORDS = Number(process.env.LLM_MAX_WORDS) || 34;
const MAX_QUESTION_CHARS = 500;
const REQUEST_TIMEOUT_MS = 30_000;

const SYSTEM_PROMPT =
  `You are Diddy, a voice assistant in a Discord call. Your answer is read aloud by text-to-speech. ` +
  `Reply in at most two short sentences and under ${MAX_WORDS - 6} words. ` +
  `Plain spoken English only: no markdown, lists, emojis, code or URLs. ` +
  `If a question is too big for that, give the single most useful point.`;

/**
 * Cleans a model reply for speech and enforces the word limit, cutting at the
 * last full sentence when possible.
 */
function toSpeakable(text, maxWords = MAX_WORDS) {
  let clean = text
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[*_`#>~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  const words = clean.split(' ');
  if (words.length <= maxWords) return clean;

  clean = words.slice(0, maxWords).join(' ');
  const lastEnd = Math.max(clean.lastIndexOf('. '), clean.lastIndexOf('! '), clean.lastIndexOf('? '));
  if (lastEnd > clean.length * 0.4) return clean.slice(0, lastEnd + 1);
  return `${clean.replace(/[,;:\s]+$/, '')}.`;
}

/** Returns a short, speakable answer to `question`. Throws an Error with a user-friendly message. */
async function askBrief(question) {
  const model = process.env.LLM_MODEL;
  if (!model) throw new Error('No AI model configured. Set LLM_MODEL (and LLM_API_KEY) in .env.');

  const baseUrl = (process.env.LLM_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const headers = { 'Content-Type': 'application/json' };
  if (process.env.LLM_API_KEY) headers.Authorization = `Bearer ${process.env.LLM_API_KEY}`;

  let response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: question.slice(0, MAX_QUESTION_CHARS) },
        ],
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    throw new Error(`Couldn't reach the AI model (${err.name === 'TimeoutError' ? 'timed out' : err.message}).`);
  }

  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 200);
    throw new Error(`The AI model returned an error (${response.status}). ${detail}`.trim());
  }

  const data = await response.json();
  const answer = toSpeakable(data?.choices?.[0]?.message?.content ?? '');
  if (!answer) throw new Error('The AI model gave an empty answer.');
  return answer;
}

module.exports = { askBrief, toSpeakable, MAX_WORDS };
