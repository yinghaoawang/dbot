const { ChannelType } = require('discord.js');

// Name of the only text channel the bot posts to (override with TEXT_CHANNEL_NAME).
const CHANNEL_NAME = (process.env.TEXT_CHANNEL_NAME || 'diddy').toLowerCase();

const warned = new Set();

/**
 * Returns the guild's #diddy text channel, or null if it doesn't exist.
 * Callers use `channel?.send(...)`, so with no #diddy channel the bot stays
 * silent in text instead of posting elsewhere.
 */
function getDiddyChannel(guild) {
  const channel = guild.channels.cache.find(
    (ch) => ch.type === ChannelType.GuildText && ch.name.toLowerCase() === CHANNEL_NAME
  );

  if (!channel && !warned.has(guild.id)) {
    warned.add(guild.id);
    console.warn(`[diddy] No #${CHANNEL_NAME} text channel in "${guild.name}"; text messages will be suppressed.`);
  }

  return channel ?? null;
}

module.exports = { getDiddyChannel };
