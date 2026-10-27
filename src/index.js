require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { Client, Collection, GatewayIntentBits } = require('discord.js');
const { startListening, isListening } = require('./utils/voiceListener');
const { ensureQueue } = require('./utils/musicQueue');
const transcriber = require('./utils/transcriber');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
  ],
});

client.commands = new Collection();

const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter((file) => file.endsWith('.js'));

for (const file of commandFiles) {
  const command = require(path.join(commandsPath, file));
  if (command.data && command.execute) {
    client.commands.set(command.data.name, command);
  } else {
    console.warn(`⚠️ Command file ${file} is missing "data" or "execute".`);
  }
}

client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  // Auto-listen if GUILD_ID and VOICE_CHANNEL_ID are set in .env
  if (process.env.GUILD_ID && process.env.VOICE_CHANNEL_ID) {
    try {
      const guild = await client.guilds.fetch(process.env.GUILD_ID);
      const voiceChannel = guild.channels.cache.get(process.env.VOICE_CHANNEL_ID);
      const textChannel = guild.systemChannel || Array.from(guild.channels.cache.values()).find((ch) => ch.isTextBased());

      if (voiceChannel && voiceChannel.isVoiceBased() && !isListening(guild.id)) {
        const queue = await ensureQueue(guild, voiceChannel, textChannel);
        startListening(guild.id, queue.connection, voiceChannel, textChannel, guild);
        console.log(`🎤 Auto-listening in ${voiceChannel.name}`);
      }
    } catch (err) {
      console.error('Failed to auto-listen:', err.message);
    }
  }
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(`Error executing command ${interaction.commandName}:`, error);
    const errorMessage = { content: '❌ There was an error running this command.', ephemeral: true };
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(errorMessage).catch(() => {});
    } else {
      await interaction.reply(errorMessage).catch(() => {});
    }
  }
});

if (!process.env.DISCORD_TOKEN) {
  console.error('❌ Missing DISCORD_TOKEN in environment. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

client.login(process.env.DISCORD_TOKEN);

// Load the Whisper model now so the first voice command isn't slow.
transcriber.preload();
process.on('exit', transcriber.stop);
