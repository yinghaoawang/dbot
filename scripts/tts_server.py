"""
Local text-to-speech server used by the Discord bot (src/utils/tts.js).

Usage:
    python tts_server.py [--port N]

Loads a Piper voice once and serves it over HTTP on 127.0.0.1 only:
    POST /synthesize   {"text": "..."}  ->  audio/wav

Once listening, prints one JSON line to stdout: {"ready": true, "port": N}.
Everything runs offline. Voices live in models/piper (download more with:
python -m piper.download_voices --download-dir models/piper <voice-name>).

Env: TTS_VOICE (Piper voice name, default en_US-joe-medium),
     TTS_LENGTH_SCALE (speaking pace, <1 is faster, default 1.0).
"""
import argparse
import io
import json
import os
import sys
import wave
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

from piper import PiperVoice, SynthesisConfig

MODELS_DIR = Path(__file__).resolve().parent.parent / "models" / "piper"
VOICE_NAME = os.environ.get("TTS_VOICE", "en_US-joe-medium")
LENGTH_SCALE = float(os.environ.get("TTS_LENGTH_SCALE", "1.0"))
MAX_TEXT_CHARS = 1000

voice = None
syn_config = SynthesisConfig(length_scale=LENGTH_SCALE)


def synthesize_wav(text: str) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wav_file:
        voice.synthesize_wav(text, wav_file, syn_config=syn_config)
    return buf.getvalue()


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path != "/synthesize":
            self.send_error(404)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            text = json.loads(self.rfile.read(length))["text"]
            if not isinstance(text, str) or not text.strip():
                raise ValueError("text must be a non-empty string")
            body = synthesize_wav(text[:MAX_TEXT_CHARS])
        except Exception as exc:  # report to the client instead of dropping the connection
            message = str(exc).encode()
            self.send_response(400)
            self.send_header("Content-Type", "text/plain")
            self.send_header("Content-Length", str(len(message)))
            self.end_headers()
            self.wfile.write(message)
            return

        self.send_response(200)
        self.send_header("Content-Type", "audio/wav")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_args):
        pass


def main():
    global voice

    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=0, help="0 picks a free port")
    args = parser.parse_args()

    model_path = MODELS_DIR / f"{VOICE_NAME}.onnx"
    if not model_path.exists():
        print(f"Voice model not found: {model_path}", file=sys.stderr)
        sys.exit(1)

    voice = PiperVoice.load(model_path)
    # Warm up so the first real request isn't slow.
    synthesize_wav("ready")

    server = HTTPServer(("127.0.0.1", args.port), Handler)
    print(json.dumps({"ready": True, "port": server.server_address[1]}), flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
