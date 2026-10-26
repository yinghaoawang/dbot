# dbot — Discord YouTube Music Bot

A Discord bot that plays audio from YouTube in a voice channel, built with `discord.js` and `@discordjs/voice`.

## Commands

- `/play query:<url or search terms>` — plays a song, or queues it if something is already playing
- `/skip` — skips the current song
- `/pause` — pauses playback
- `/resume` — resumes playback
- `/stop` — clears the queue and leaves the voice channel
- `/queue` — shows the current queue

## Setup

1. **Create a Discord application & bot**
   - Go to the [Discord Developer Portal](https://discord.com/developers/applications) → New Application.
   - Go to **Bot** → Reset Token, copy it.
   - Under **Privileged Gateway Intents**, no privileged intents are required for this bot.
   - Go to **OAuth2 → URL Generator**, select scopes `bot` and `applications.commands`, and permissions `Connect`, `Speak`, `Send Messages`, `View Channel`. Use the generated URL to invite the bot to your server.

2. **Install dependencies**

   ```sh
   npm install
   ```

3. **Configure environment variables**

   Copy `.env.example` to `.env` and fill in:

   ```
   DISCORD_TOKEN=your-bot-token-here
   CLIENT_ID=your-application-client-id-here
   GUILD_ID=your-test-server-id-here   # optional, enables instant command registration for one server
   ```

4. **Register slash commands**

   ```sh
   npm run deploy
   ```

5. **Start the bot**

   ```sh
   npm start
   ```

## Notes

- Uses [`play-dl`](https://www.npmjs.com/package/play-dl) to search/stream YouTube audio — no API key required for basic search/playback.
- If you hit YouTube throttling/age-restriction issues, you may need to configure `play-dl` cookies (see its README) for more reliable streaming.
- Voice playback requires FFmpeg; `ffmpeg-static` is bundled so no system install is needed.
