// Asks a large language model for a short answer that can be spoken aloud.
// Calls go through the Perplexity Orchestrator API (OpenAI Chat Completions
// schema) so any model in its catalog can be swapped in via env:
//   PERPLEXITY_API_KEY  (required) key from https://console.perplexity.ai
//   LLM_MODEL           (required) `creator/model-name` slug from GET /orchestrator/v1/models
//   LLM_MAX_WORDS       default 34 (about 11 seconds with the en_US-joe-medium voice)

const OpenAI = require('openai');

const ORCHESTRATOR_BASE_URL = 'https://api.perplexity.ai/orchestrator/v1';

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

let client;
function getClient() {
  // The SDK retries 429/5xx once, honoring the Retry-After header.
  client ??= new OpenAI({
    apiKey: process.env.PERPLEXITY_API_KEY,
    baseURL: ORCHESTRATOR_BASE_URL,
    timeout: REQUEST_TIMEOUT_MS,
    maxRetries: 1,
  });
  return client;
}

/** Maps an SDK error to a short message that is safe to show or speak (never includes the key). */
function describeError(err) {
  if (err instanceof OpenAI.APIConnectionTimeoutError) return "The AI model timed out.";
  if (err instanceof OpenAI.APIConnectionError) return "Couldn't reach the AI model.";
  switch (err?.status) {
    case 400: return `The AI model rejected the request (is LLM_MODEL a valid catalog slug?). ${err.message}`.slice(0, 200);
    case 401: return 'The AI model rejected the API key. Check PERPLEXITY_API_KEY.';
    case 402: return 'That model is not available on this Perplexity usage tier.';
    case 429: return 'The AI model is busy right now. Try again in a moment.';
    default: return `The AI model returned an error (${err?.status ?? 'unknown'}).`;
  }
}

/** Returns a short, speakable answer to `question`. Throws an Error with a user-friendly message. */
async function askBrief(question) {
  const model = process.env.LLM_MODEL;
  if (!process.env.PERPLEXITY_API_KEY || !model) {
    throw new Error('No AI model configured. Set PERPLEXITY_API_KEY and LLM_MODEL in .env.');
  }

  let completion;
  try {
    completion = await getClient().chat.completions.create({
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: question.slice(0, MAX_QUESTION_CHARS) },
      ],
    });
  } catch (err) {
    throw new Error(describeError(err));
  }

  const answer = toSpeakable(completion?.choices?.[0]?.message?.content ?? '');
  if (!answer) throw new Error('The AI model gave an empty answer.');
  return answer;
}

module.exports = { askBrief, toSpeakable, MAX_WORDS };
