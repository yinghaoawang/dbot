"""
Standalone transcription helper used by the Discord bot (src/utils/voiceListener.js).

Usage:
    python transcribe.py <path-to-wav-file>

Prints the transcribed text to stdout (and nothing else on success).
Reads the WAV file directly with the stdlib `wave` module and converts it to
a float32 numpy array, bypassing faster-whisper's built-in PyAV-based decoder
(whose API is incompatible with the PyAV wheel available for this Python
version). Loads the faster-whisper model once per process invocation; the
bot spawns this script per utterance. The model itself is cached on disk by
faster-whisper (downloaded to ~/.cache/huggingface on first run).
"""
import sys
import os
import wave

MODEL_SIZE = os.environ.get("WHISPER_MODEL_SIZE", "base")
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


def main():
    if len(sys.argv) != 2:
        print("Usage: python transcribe.py <wav-file>", file=sys.stderr)
        sys.exit(1)

    wav_path = sys.argv[1]

    from faster_whisper import WhisperModel

    audio = load_wav_as_float32(wav_path)

    model = WhisperModel(MODEL_SIZE, device="cpu", compute_type="int8")
    segments, _info = model.transcribe(
        audio,
        beam_size=5,
        language="en",
        initial_prompt=f"{WAKE_WORD}, play some music. {WAKE_WORD}, skip. {WAKE_WORD}, pause.",
        hotwords=WAKE_WORD,
    )

    text = "".join(segment.text for segment in segments).strip()
    print(text)


if __name__ == "__main__":
    main()

