const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ffmpegPath = require('ffmpeg-static');

const PYTHON_PATH = process.env.PYTHON_PATH || 'C:/Program Files/Python314/python.exe';
const TTS_SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'tts.py');
const CACHE_DIR = path.join(os.tmpdir(), 'dbot-tts');

function run(command, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(command)} exited with code ${code}: ${stderr}`));
    });
  });
}

/**
 * Synthesizes `text` to an MP3 and returns its path. Results are cached on
 * disk (keyed by voice + text) so repeated phrases play instantly.
 */
async function synthesize(text) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const voice = process.env.TTS_VOICE || 'en-US-GuyNeural';
  const hash = crypto.createHash('sha1').update(`${voice}\n${text}`).digest('hex');
  const mp3Path = path.join(CACHE_DIR, `${hash}.mp3`);

  if (!fs.existsSync(mp3Path)) {
    const tmpPath = `${mp3Path}.${process.pid}.tmp`;
    try {
      await run(PYTHON_PATH, [TTS_SCRIPT, tmpPath, text]);
      fs.renameSync(tmpPath, mp3Path);
    } finally {
      fs.rm(tmpPath, { force: true }, () => {});
    }
  }
  return mp3Path;
}

/** Starts an ffmpeg process decoding the audio file to raw 48kHz stereo s16le PCM, with volume boost. */
function decodeToPcm(filePath, volumeGain = 2) {
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
  ffmpeg.stderr.on('data', (data) => console.error('ffmpeg (tts):', data.toString()));
  ffmpeg.on('error', (err) => console.error('ffmpeg (tts) process error:', err));
  return ffmpeg;
}

module.exports = { synthesize, decodeToPcm };
