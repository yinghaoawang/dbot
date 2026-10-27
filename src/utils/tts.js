const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');
const ffmpegPath = require('ffmpeg-static');

const PYTHON_PATH = process.env.PYTHON_PATH || 'C:/Program Files/Python314/python.exe';
const TTS_SERVER_SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'tts_server.py');
const CACHE_DIR = path.join(os.tmpdir(), 'dbot-tts');
const VOICE = process.env.TTS_VOICE || 'en_US-joe-medium';
const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Keeps one local `tts_server.py` (Piper) process running so the voice model
 * is loaded once. Restarts on the next request if it dies.
 * @type {{proc: import('child_process').ChildProcess, ready: Promise<number>} | null}
 */
let server = null;

function startServer() {
  const proc = spawn(PYTHON_PATH, [TTS_SERVER_SCRIPT], { stdio: ['ignore', 'pipe', 'pipe'] });
  const state = { proc, ready: null };

  state.ready = new Promise((resolve, reject) => {
    let stderrTail = '';
    proc.stderr.on('data', (chunk) => {
      stderrTail = (stderrTail + chunk.toString()).slice(-2000);
    });
    readline.createInterface({ input: proc.stdout }).on('line', (line) => {
      try {
        const msg = JSON.parse(line);
        if (msg.ready) {
          console.log(`[tts] ${VOICE} ready on 127.0.0.1:${msg.port}`);
          resolve(msg.port);
        }
      } catch {
        // ignore non-JSON output
      }
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (server === state) server = null;
      reject(new Error(`tts_server.py exited with code ${code}: ${stderrTail}`));
    });
  });
  state.ready.catch(() => {});

  return state;
}

function getServer() {
  if (!server) server = startServer();
  return server;
}

/** Starts the TTS server ahead of the first request. */
function preload() {
  getServer();
}

function stop() {
  if (server) {
    server.proc.kill();
    server = null;
  }
}

/**
 * Synthesizes `text` to a WAV and returns its path. Results are cached on
 * disk (keyed by voice + text) so repeated phrases play instantly.
 */
async function synthesize(text) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const hash = crypto.createHash('sha1').update(`${VOICE}\n${text}`).digest('hex');
  const wavPath = path.join(CACHE_DIR, `${hash}.wav`);
  if (fs.existsSync(wavPath)) return wavPath;

  const port = await getServer().ready;
  const response = await fetch(`http://127.0.0.1:${port}/synthesize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`TTS server error ${response.status}: ${await response.text()}`);

  const tmpPath = `${wavPath}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmpPath, Buffer.from(await response.arrayBuffer()));
    fs.renameSync(tmpPath, wavPath);
  } finally {
    fs.rm(tmpPath, { force: true }, () => {});
  }
  return wavPath;
}

/** Decodes the audio file to a Buffer of raw 48kHz stereo s16le PCM, with volume boost. */
function decodeToBuffer(filePath, volumeGain = 1) {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn(
      ffmpegPath,
      [
        '-loglevel', 'error',
        '-i', filePath,
        '-af', `volume=${volumeGain}`,
        '-f', 's16le',
        '-ar', '48000',
        '-ac', '2',
        'pipe:1',
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );

    const chunks = [];
    let stderr = '';
    ffmpeg.stdout.on('data', (chunk) => chunks.push(chunk));
    ffmpeg.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    ffmpeg.on('error', reject);
    ffmpeg.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(chunks));
      else reject(new Error(`ffmpeg exited with code ${code}: ${stderr}`));
    });
  });
}

module.exports = { synthesize, decodeToBuffer, preload, stop };
