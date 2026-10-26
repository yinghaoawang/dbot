/**
 * Standalone local playback test — bypasses Discord entirely.
 *
 * Downloads a YouTube video's best audio via yt-dlp, transcodes it to a WAV
 * file via ffmpeg, and opens it with your system's default media player.
 *
 * Usage:
 *   node scripts/test-audio.js "https://www.youtube.com/watch?v=VIDEO_ID"
 *   node scripts/test-audio.js "search terms"
 */
const { spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const youtubedl = require('yt-dlp-exec');
const ffmpegPath = require('ffmpeg-static');
const yts = require('yt-search');

const YOUTUBE_URL_REGEX = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be|music\.youtube\.com)\/.+$/i;

async function resolveUrl(query) {
  if (YOUTUBE_URL_REGEX.test(query)) return query;
  const result = await yts(query);
  const video = result.videos?.[0];
  if (!video) throw new Error('No search results found.');
  console.log(`Found: ${video.title} (${video.url})`);
  return video.url;
}

function openFile(filePath) {
  const platform = os.platform();
  if (platform === 'win32') {
    spawn('cmd', ['/c', 'start', '""', filePath], { stdio: 'ignore', detached: true }).unref();
  } else if (platform === 'darwin') {
    spawn('open', [filePath], { stdio: 'ignore', detached: true }).unref();
  } else {
    spawn('xdg-open', [filePath], { stdio: 'ignore', detached: true }).unref();
  }
}

async function main() {
  const query = process.argv.slice(2).join(' ');
  if (!query) {
    console.error('Usage: node scripts/test-audio.js "<YouTube URL or search terms>"');
    process.exit(1);
  }

  const url = await resolveUrl(query);
  const outFile = path.join(os.tmpdir(), `dbot-test-${Date.now()}.wav`);

  console.log(`Downloading + transcoding: ${url}`);
  console.log(`Output: ${outFile}`);

  const subprocess = youtubedl.exec(
    url,
    {
      output: '-',
      format: 'bestaudio/best',
      noPlaylist: true,
      noWarnings: true,
      quiet: true,
    },
    { stdio: ['ignore', 'pipe', 'pipe'] }
  );

  subprocess.stderr?.on('data', (d) => process.stderr.write(`yt-dlp: ${d}`));
  subprocess.catch((err) => {
    if (!err?.isCanceled && !err?.killed) {
      console.error('yt-dlp process error:', err?.shortMessage ?? err);
    }
  });

  const ffmpeg = spawn(
    ffmpegPath,
    ['-y', '-loglevel', 'error', '-i', 'pipe:0', outFile],
    { stdio: ['pipe', 'ignore', 'pipe'] }
  );

  subprocess.stdout.pipe(ffmpeg.stdin);
  ffmpeg.stderr.on('data', (d) => process.stderr.write(`ffmpeg: ${d}`));

  ffmpeg.on('close', (code) => {
    if (code !== 0) {
      console.error(`ffmpeg exited with code ${code}`);
      process.exit(1);
    }
    console.log('✅ Done. Opening file with default player...');
    openFile(outFile);
  });
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
