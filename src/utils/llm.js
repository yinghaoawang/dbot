// Asks a large language model for a short answer that can be spoken aloud.
// Calls go through the Perplexity Orchestrator API (OpenAI Chat Completions
// schema) so any model in its catalog can be swapped in via env:
//   PERPLEXITY_API_KEY  (required) key from https://console.perplexity.ai
//   LLM_MODEL           (required) `creator/model-name` slug from GET /orchestrator/v1/models
//   LLM_MAX_WORDS       default 34 (about 11 seconds with the en_US-joe-medium voice)
//   LLM_WEB_SEARCH      default on; set to 0/false to skip the web search
//
// Before asking the model, the question is run through the Perplexity Search API
// with search_type "fast" ($1 per 1,000 requests) and the result snippets are
// given to the model as context. If the search fails the model answers without it.

const OpenAI = require('openai');

const ORCHESTRATOR_BASE_URL = 'https://api.perplexity.ai/orchestrator/v1';
const SEARCH_URL = 'https://api.perplexity.ai/search';
const SEARCH_TIMEOUT_MS = 5_000;
const SEARCH_MAX_RESULTS = 5;
const SEARCH_TOKENS_PER_PAGE = 300;
const SEARCH_MAX_TOKENS = 1200;
const WEB_SEARCH_ENABLED = !/^(0|false|off|no)$/i.test(process.env.LLM_WEB_SEARCH ?? '');

const MAX_WORDS = Number(process.env.LLM_MAX_WORDS) || 34;
const MAX_QUESTION_CHARS = 500;
const REQUEST_TIMEOUT_MS = 30_000;

const SYSTEM_PROMPT =
  `You are Diddy, a voice assistant in a Discord call. Your answer is read aloud by text-to-speech. ` +
  `Reply in at most two short sentences and under ${MAX_WORDS - 6} words. ` +
  `Plain spoken English only: no markdown, lists, emojis, code or URLs. ` +
  `If a question is too big for that, give the single most useful point. ` +
  `If web search results are provided, base your answer on them and prefer the most recent information.`;

/**
 * Fast web search for `question`. Returns a text block of result snippets for the
 * model, or '' when search is disabled, fails, or finds nothing (never throws).
 */
async function searchWeb(question) {
  if (!WEB_SEARCH_ENABLED) return '';
  try {
    const response = await fetch(SEARCH_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.PERPLEXITY_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: question.slice(0, MAX_QUESTION_CHARS),
        search_type: 'fast',
        max_results: SEARCH_MAX_RESULTS,
        max_tokens: SEARCH_MAX_TOKENS,
        max_tokens_per_page: SEARCH_TOKENS_PER_PAGE,
      }),
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      console.warn(`[llm] Web search failed (${response.status}); answering without it.`);
      return '';
    }
    const data = await response.json();
    return (data?.results ?? [])
      .filter((r) => r?.snippet)
      .map((r, i) => `[${i + 1}] ${r.title ?? ''}${r.date ? ` (${r.date})` : ''}: ${r.snippet}`)
      .join('\n\n');
  } catch (err) {
    console.warn(`[llm] Web search failed (${err.name === 'TimeoutError' ? 'timed out' : err.message}); answering without it.`);
    return '';
  }
}

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
    const trimmed = question.slice(0, MAX_QUESTION_CHARS);
    const searchResults = await searchWeb(trimmed);
    const userContent = searchResults
      ? `Web search results:\n${searchResults}\n\nQuestion: ${trimmed}`
      : trimmed;
    completion = await getClient().chat.completions.create({
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userContent },
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
