const { spawn } = require('node:child_process');
const path = require('node:path');
const readline = require('node:readline');

const PYTHON_PATH = process.env.PYTHON_PATH || 'C:/Program Files/Python314/python.exe';
const TRANSCRIBE_SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'transcribe.py');
// Generous because the first request may wait for the model to load/download.
const REQUEST_TIMEOUT_MS = 120_000;

/**
 * Keeps a single long-running `transcribe.py --server` process so the Whisper
 * model is loaded once instead of once per utterance. Restarts automatically
 * if the process dies.
 */
let worker = null;
let nextId = 1;
/** @type {Map<number, {resolve: Function, reject: Function, timer: NodeJS.Timeout}>} */
const pending = new Map();

function failAll(error) {
  for (const [id, entry] of pending) {
    clearTimeout(entry.timer);
    entry.reject(error);
    pending.delete(id);
  }
}

function startWorker() {
  const proc = spawn(PYTHON_PATH, [TRANSCRIBE_SCRIPT, '--server'], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const state = { proc, ready: false, readyPromise: null };

  state.readyPromise = new Promise((resolve, reject) => {
    state.resolveReady = resolve;
    state.rejectReady = reject;
  });
  // Avoid unhandled rejection if nobody is awaiting readiness when it fails.
  state.readyPromise.catch(() => {});

  readline.createInterface({ input: proc.stdout }).on('line', (line) => {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (msg.ready) {
      state.ready = true;
      state.resolveReady();
      console.log('[transcriber] Whisper model loaded and ready');
      return;
    }
    const entry = pending.get(msg.id);
    if (!entry) return;
    pending.delete(msg.id);
    clearTimeout(entry.timer);
    if (msg.error) entry.reject(new Error(msg.error));
    else {
      entry.resolve({
        text: msg.text ?? '',
        // null when Whisper produced no segments
        noSpeechProb: msg.no_speech_prob ?? null,
        avgLogprob: msg.avg_logprob ?? null,
      });
    }
  });

  let stderrTail = '';
  proc.stderr.on('data', (chunk) => {
    stderrTail = (stderrTail + chunk.toString()).slice(-2000);
  });

  proc.stdin.on('error', () => {});
  proc.on('error', (err) => {
    state.rejectReady(err);
    failAll(err);
    if (worker === state) worker = null;
  });
  proc.on('close', (code) => {
    const err = new Error(`transcribe.py worker exited with code ${code}: ${stderrTail}`);
    state.rejectReady(err);
    failAll(err);
    if (worker === state) worker = null;
  });

  return state;
}

function getWorker() {
  if (!worker) worker = startWorker();
  return worker;
}

/** Starts the worker (and loads the model) ahead of the first utterance. */
function preload() {
  getWorker();
}

function stop() {
  if (worker) {
    worker.proc.kill();
    worker = null;
  }
}

/**
 * Transcribes a 16-bit PCM WAV file. Resolves with the text plus Whisper's
 * confidence stats: { text, noSpeechProb, avgLogprob }.
 */
function transcribeWav(wavPath) {
  const w = getWorker();
  const id = nextId++;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Transcription timed out after ${REQUEST_TIMEOUT_MS / 1000} seconds`));
      // A stuck worker would block every later request; restart it.
      if (worker === w) stop();
    }, REQUEST_TIMEOUT_MS);

    pending.set(id, { resolve, reject, timer });
    w.proc.stdin.write(`${JSON.stringify({ id, path: wavPath })}\n`);
  });
}

module.exports = { transcribeWav, preload, stop };
