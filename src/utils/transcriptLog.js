const fs = require('node:fs');
const path = require('node:path');

// One plain-text file per day (local time): data/transcripts/YYYY-MM-DD.log
const LOG_DIR = path.join(__dirname, '..', '..', 'data', 'transcripts');

const pad = (n) => String(n).padStart(2, '0');

/**
 * Appends one line to today's transcript log:
 *   [HH:MM:SS] [Guild #voice-channel] Name: text
 */
function logTranscript({ guild, voiceChannel, userId, text }) {
  const now = new Date();
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  const member = voiceChannel.members?.get(userId) ?? guild.members.cache.get(userId);
  const name = member?.displayName ?? member?.user?.username ?? userId;
  const line = `[${time}] [${guild.name} #${voiceChannel.name}] ${name}: ${text.replace(/\s+/g, ' ')}\n`;

  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFile(path.join(LOG_DIR, `${date}.log`), line, (err) => {
      if (err) console.error('Failed to write transcript log:', err);
    });
  } catch (err) {
    console.error('Failed to write transcript log:', err);
  }
}

module.exports = { logTranscript, LOG_DIR };
