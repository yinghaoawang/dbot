/**
 * Fuzzy, sound-based wake word detection.
 *
 * Instead of listing every way Whisper might mis-transcribe the wake phrase,
 * both the phrase and the transcript are reduced to a rough phonetic key
 * (similar-sounding consonants merged, vowels collapsed) and compared with
 * edit distance. "hey diddy", "a ditty", "hey dd" and "hey d d" all reduce to
 * the same or nearly the same key.
 */

const WAKE_PHRASE = (process.env.WAKE_WORD || 'hey diddy').toLowerCase().trim();
const THRESHOLD = Number(process.env.WAKE_THRESHOLD) || 0.92;
// Only look for the wake phrase near the start of an utterance.
const MAX_START_WORD = 2;

const SOUND_CLASS = {
  a: 'a', e: 'a', i: 'a', o: 'a', u: 'a', y: 'a',
  h: '', w: '',
  d: 'D', t: 'D',
  b: 'B', p: 'B',
  f: 'F', v: 'F',
  g: 'K', k: 'K', c: 'K', q: 'K',
  s: 'S', z: 'S', x: 'S',
  m: 'N', n: 'N',
  l: 'L', r: 'R', j: 'J',
};

function phoneticKey(words) {
  let key = '';
  for (const word of words) {
    // Short vowel-less tokens ("dd", "d") are spelled-out letters: "dee dee".
    const spelledOut = word.length <= 3 && !/[aeiouy]/.test(word);
    const letters = spelledOut ? word.split('').map((c) => `${c}e`).join('') : word;
    for (const ch of letters) {
      const cls = SOUND_CLASS[ch];
      if (!cls) continue;
      if (key[key.length - 1] !== cls) key += cls;
    }
  }
  return key;
}

function editDistance(a, b) {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

function similarity(a, b) {
  if (!a || !b) return 0;
  return 1 - editDistance(a, b) / Math.max(a.length, b.length);
}

const wakeWords = WAKE_PHRASE.split(/\s+/);
const wakeKey = phoneticKey(wakeWords);

/**
 * Looks for the wake phrase in a normalized (lowercase, punctuation-free)
 * transcript. Returns { score, after } where `after` is the text following
 * the matched phrase, or null if no window sounds close enough.
 */
function findWakeWord(normalized) {
  const words = normalized.split(' ').filter(Boolean);
  let best = null;

  for (let start = 0; start <= Math.min(MAX_START_WORD, words.length - 1); start++) {
    for (let len = Math.max(1, wakeWords.length - 1); len <= wakeWords.length + 1; len++) {
      if (start + len > words.length) break;
      const score = similarity(phoneticKey(words.slice(start, start + len)), wakeKey);
      if (score >= THRESHOLD && (!best || score > best.score)) {
        best = { score, end: start + len };
      }
    }
  }

  if (!best) return null;
  return { score: best.score, after: words.slice(best.end).join(' ') };
}

module.exports = { findWakeWord, WAKE_PHRASE };
