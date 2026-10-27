"""
Text-to-speech helper used by the Discord bot (src/utils/tts.js).

Usage:
    python tts.py <output-mp3-path> <text>

Synthesizes `text` with Microsoft Edge's neural voices (edge-tts, no API key
required, needs internet access) and writes an MP3 to <output-mp3-path>.
The voice can be changed with the TTS_VOICE env var
(list voices with: python -m edge_tts --list-voices).
"""
import asyncio
import os
import sys

VOICE = os.environ.get("TTS_VOICE", "en-US-GuyNeural")


async def main():
    if len(sys.argv) != 3:
        print("Usage: python tts.py <output-mp3-path> <text>", file=sys.stderr)
        sys.exit(1)

    import edge_tts

    out_path, text = sys.argv[1], sys.argv[2]
    await edge_tts.Communicate(text, VOICE).save(out_path)


if __name__ == "__main__":
    asyncio.run(main())
