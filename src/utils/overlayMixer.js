const { Transform } = require('node:stream');

const BYTES_PER_FRAME = 4; // 16-bit stereo
// Music volume while an overlay (e.g. TTS) is playing on top of it.
const DUCK_GAIN = 0.35;

/**
 * Pass-through for raw 48kHz s16le stereo PCM that can mix a short clip on top
 * of the stream (lowering the stream's volume while the clip plays). Lets the
 * bot talk over music without pausing it.
 */
class OverlayMixer extends Transform {
  constructor() {
    super();
    this.overlay = null;
    this.offset = 0;
    this.resolveOverlay = null;
    this.carry = Buffer.alloc(0);
  }

  /** Mixes `pcm` into the stream. Resolves once it has fully played (or the stream ended). */
  playOverlay(pcm) {
    this.finishOverlay();
    if (this.destroyed || this.writableEnded) return Promise.resolve();
    return new Promise((resolve) => {
      this.overlay = pcm;
      this.offset = 0;
      this.resolveOverlay = resolve;
    });
  }

  finishOverlay() {
    const resolve = this.resolveOverlay;
    this.overlay = null;
    this.resolveOverlay = null;
    this.offset = 0;
    resolve?.();
  }

  _transform(chunk, _encoding, callback) {
    let data = this.carry.length ? Buffer.concat([this.carry, chunk]) : chunk;
    // Keep whole stereo frames so samples stay aligned across chunks.
    const usable = data.length - (data.length % BYTES_PER_FRAME);
    this.carry = data.subarray(usable);
    data = data.subarray(0, usable);

    if (this.overlay) this.mix(data);
    callback(null, data);
  }

  mix(data) {
    const length = Math.min(data.length, this.overlay.length - this.offset);
    for (let i = 0; i < length; i += 2) {
      const sum = data.readInt16LE(i) * DUCK_GAIN + this.overlay.readInt16LE(this.offset + i);
      data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(sum))), i);
    }
    this.offset += length;
    if (this.offset >= this.overlay.length) this.finishOverlay();
  }

  _flush(callback) {
    this.finishOverlay();
    callback();
  }

  _destroy(err, callback) {
    this.finishOverlay();
    callback(err);
  }
}

module.exports = { OverlayMixer };
