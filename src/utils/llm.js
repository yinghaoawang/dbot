// Answers a question for speech using only the Perplexity Search API (Fast Search,
// $1 per 1,000 requests) through the official SDK. There is no language model: the
// result snippets are cleaned, split into sentences, and the sentence that best
// matches the question is spoken. Configure with env:
//   PERPLEXITY_API_KEY  (required) key from https://console.perplexity.ai

const SEARCH_TIMEOUT_MS = 8_000;
const SEARCH_MAX_RESULTS = 5;
const SEARCH_TOKENS_PER_PAGE = 300;
const SEARCH_MAX_TOKENS = 1200;

const MAX_QUESTION_CHARS = 500;
const MIN_SENTENCE_WORDS = 5;
const MAX_SENTENCE_WORDS = 60;

const STOPWORDS = new Set((
  'a an the is are was were be been am do does did of in on at to for from by with and or but as it its this that these those ' +
  'what whats which who whom whose when where why how many much can could would should will you your me my i we us they them ' +
  'tell about please hey diddy there here s'
).split(' '));

// Questions asking for a number or a date prefer sentences containing digits.
const WANTS_NUMBER = /\b(how (many|much|tall|long|old|big|far|fast|high|deep)|when|what year|what time|population|price|cost|score)\b/i;
const JUNK = /https?:\/\/|www\.|cookie|subscribe|sign up|click here|privacy policy|all rights reserved/i;
const CODE_LIKE = /[{}[\];=<]|\)\s*\{|\bfunction\b/;
const ABBREVIATIONS = /\b(Mt|St|Dr|Mr|Mrs|Ms|Jr|Sr|vs|approx|No|Inc|Ltd|U\.S|U\.K|a\.m|p\.m)\./g;

function normalize(word) {
  return word.length > 3 && word.endsWith('s') ? word.slice(0, -1) : word;
}

function keywordsOf(text) {
  const words = text
    .toLowerCase()
    .replace(/['\u2019]s\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((w) => w && !STOPWORDS.has(w))
    .map(normalize);
  return [...new Set(words)];
}

/** Splits a markdown snippet into plain candidate sentences. */
function sentencesOf(snippet) {
  const out = [];
  for (const rawLine of snippet.split('\n')) {
    let line = rawLine.trim();
    if (!line || line.startsWith('|') || line.startsWith('#') || /^\.{3}$/.test(line)) continue;
    line = line
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/^(?:[-*+]|\d+[.)])\s+/, '')
      .replace(/[*_`~>]/g, '')
      .replace(ABBREVIATIONS, (m) => m.replace(/\./g, '\u0000'))
      .replace(/\s+/g, ' ')
      .trim();
    for (const part of line.split(/(?<=[.!?])\s+/)) {
      const sentence = part.replace(/\u0000/g, '.').trim();
      const words = sentence.split(' ').length;
      if (words < MIN_SENTENCE_WORDS || words > MAX_SENTENCE_WORDS) continue;
      if (JUNK.test(sentence) || CODE_LIKE.test(sentence) || sentence.includes('|')) continue;
      if (sentence.endsWith('?')) continue; // a question is never the answer
      out.push(sentence);
    }
  }
  return out;
}

/**
 * Picks the sentence from `results` ([{ title, snippet }, ...] in rank order)
 * that best answers `question`. Returns '' if nothing matches well enough.
 */
function extractAnswer(question, results) {
  const keywords = keywordsOf(question);
  if (keywords.length === 0) return '';
  const wantsNumber = WANTS_NUMBER.test(question);

  let best = { score: 0, sentence: '' };
  results.forEach((result, rank) => {
    if (!result?.snippet) return;
    for (const sentence of sentencesOf(result.snippet)) {
      const sentenceWords = new Set(keywordsOf(sentence));
      const matched = keywords.filter((k) => sentenceWords.has(k)).length;
      const coverage = matched / keywords.length;
      if (matched === 0 || coverage < 0.5) continue;

      let score = coverage * 3 - rank * 0.15;
      if (wantsNumber && /\d/.test(sentence)) score += 1;
      if (!/[.!?]$/.test(sentence)) score -= 0.5;
      if (score > best.score) best = { score, sentence };
    }
  });
  return best.sentence;
}

/** Cleans text for speech (no length limit). */
function toSpeakable(text) {
  return text
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\((?:credit|source|photo|image)s?:[^)]*\)/gi, '')
    .replace(/[*_`#>~]/g, '')
    .replace(/^[-\s]+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Maps an SDK error to a short message that is safe to show or speak (never includes the key). */
function describeError(err) {
  switch (err?.status) {
    case 401:
    case 403: return 'Perplexity rejected the API key. Check PERPLEXITY_API_KEY.';
    case 429: return 'Web search is busy right now. Try again in a moment.';
    case undefined: return `Couldn't reach web search (${/timeout|timed out/i.test(err?.name + err?.message) ? 'timed out' : 'network error'}).`;
    default: return `Web search returned an error (${err.status}).`;
  }
}

// The SDK is ESM-only, so it is loaded with import() from this CommonJS module.
let clientPromise;
function getClient() {
  clientPromise ??= import('@perplexity-ai/perplexity_ai').then(
    ({ default: Perplexity }) =>
      // The SDK retries 429/5xx once, honoring Retry-After.
      new Perplexity({ apiKey: process.env.PERPLEXITY_API_KEY, timeout: SEARCH_TIMEOUT_MS, maxRetries: 1 })
  );
  return clientPromise;
}

/** Runs a Fast Search and returns the result list. Throws an Error with a user-friendly message. */
async function searchWeb(question) {
  try {
    const client = await getClient();
    const search = await client.search.create({
      query: question,
      search_type: 'fast',
      max_results: SEARCH_MAX_RESULTS,
      max_tokens: SEARCH_MAX_TOKENS,
      max_tokens_per_page: SEARCH_TOKENS_PER_PAGE,
    });
    return search?.results ?? [];
  } catch (err) {
    throw new Error(describeError(err));
  }
}

/** Returns a short, speakable answer to `question`. Throws an Error with a user-friendly message. */
async function askBrief(question) {
  if (!process.env.PERPLEXITY_API_KEY) {
    throw new Error('Web search is not configured. Set PERPLEXITY_API_KEY in .env.');
  }
  const trimmed = question.slice(0, MAX_QUESTION_CHARS);
  const results = await searchWeb(trimmed);
  const answer = toSpeakable(extractAnswer(trimmed, results));
  if (!answer) throw new Error("I couldn't find a clear answer to that.");
  return answer;
}

module.exports = { askBrief, extractAnswer, toSpeakable };
