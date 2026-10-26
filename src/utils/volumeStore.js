const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const VOLUMES_FILE = path.join(DATA_DIR, 'volumes.json');

/** @type {Map<string, number>} */
let cache = new Map();

function load() {
  try {
    const raw = fs.readFileSync(VOLUMES_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    cache = new Map(Object.entries(parsed));
  } catch {
    cache = new Map();
  }
}

function save() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const obj = Object.fromEntries(cache);
    fs.writeFileSync(VOLUMES_FILE, JSON.stringify(obj, null, 2));
  } catch (err) {
    console.error('Failed to persist guild volumes:', err);
  }
}

function get(guildId) {
  return cache.get(guildId);
}

function set(guildId, volume) {
  cache.set(guildId, volume);
  save();
}

load();

module.exports = { get, set };
