"""
Transcription helper used by the Discord bot (src/utils/transcriber.js).

Usage:
    python transcribe.py --server          # long-running worker (used by the bot)
    python transcribe.py <path-to-wav>     # one-shot, prints the transcript

Server mode loads the faster-whisper model once, prints {"ready": true}, then
reads one JSON request per stdin line ({"id": 1, "path": "x.wav"}) and writes
one JSON response per stdout line ({"id": 1, "text": "..."} or
{"id": 1, "error": "..."}). This avoids reloading the model for every
utterance, which is the slowest part of transcription.

Reads the WAV file directly with the stdlib `wave` module and converts it to
a float32 numpy array, bypassing faster-whisper's built-in PyAV-based decoder
(whose API is incompatible with the PyAV wheel available for this Python
version). The model itself is cached on disk by faster-whisper
(downloaded to ~/.cache/huggingface on first run).
"""
import json
import sys
import os
import wave

MODEL_SIZE = os.environ.get("WHISPER_MODEL_SIZE", "base.en")
WAKE_WORD = os.environ.get("WAKE_WORD", "Hey Diddy")
TARGET_SAMPLE_RATE = 16000


def load_wav_as_float32(wav_path):
    import numpy as np

    with wave.open(wav_path, "rb") as wf:
        channels = wf.getnchannels()
        sample_width = wf.getsampwidth()
        sample_rate = wf.getframerate()
        frames = wf.readframes(wf.getnframes())

    if sample_width != 2:
        raise ValueError(f"Unsupported sample width: {sample_width} bytes (expected 16-bit PCM)")

    audio = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0

    if channels > 1:
        audio = audio.reshape(-1, channels).mean(axis=1)

    if sample_rate != TARGET_SAMPLE_RATE:
        # Simple linear resampling (good enough for speech commands).
        duration = len(audio) / sample_rate
        target_length = int(round(duration * TARGET_SAMPLE_RATE))
        original_indices = np.linspace(0, len(audio) - 1, num=len(audio))
        target_indices = np.linspace(0, len(audio) - 1, num=target_length)
        audio = np.interp(target_indices, original_indices, audio).astype(np.float32)

    return audio


def load_model():
    from faster_whisper import WhisperModel

    return WhisperModel(
        MODEL_SIZE,
        device="cpu",
        compute_type="int8",
        cpu_threads=int(os.environ.get("WHISPER_CPU_THREADS", "0")),
    )


def transcribe(model, wav_path):
    audio = load_wav_as_float32(wav_path)
    segments, _info = model.transcribe(
        audio,
        beam_size=1,
        language="en",
        initial_prompt=f"{WAKE_WORD}, play some music. {WAKE_WORD}, skip. {WAKE_WORD}, pause.",
        hotwords=WAKE_WORD,
        condition_on_previous_text=False,
    )
    return "".join(segment.text for segment in segments).strip()


def serve():
    # Keep stdout strictly JSON lines; send any library noise to stderr.
    out = sys.stdout
    sys.stdout = sys.stderr

    def send(obj):
        out.write(json.dumps(obj) + "\n")
        out.flush()

    model = load_model()
    # Warm up so the first real request isn't slowed by lazy initialization.
    try:
        import numpy as np

        list(model.transcribe(np.zeros(TARGET_SAMPLE_RATE, dtype=np.float32), beam_size=1, language="en")[0])
    except Exception as err:
        print(f"warmup failed: {err}", file=sys.stderr)
    send({"ready": True})

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        req_id = None
        try:
            req = json.loads(line)
            req_id = req.get("id")
            send({"id": req_id, "text": transcribe(model, req["path"])})
        except Exception as err:
            send({"id": req_id, "error": f"{type(err).__name__}: {err}"})


def main():
    if len(sys.argv) == 2 and sys.argv[1] == "--server":
        serve()
        return

    if len(sys.argv) != 2:
        print("Usage: python transcribe.py --server | <wav-file>", file=sys.stderr)
        sys.exit(1)

    print(transcribe(load_model(), sys.argv[1]))


if __name__ == "__main__":
    main()

