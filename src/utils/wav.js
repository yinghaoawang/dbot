/**
 * Builds a WAV (RIFF/PCM) file buffer from raw PCM data.
 * @param {Buffer} pcmData raw PCM samples (signed 16-bit little-endian)
 * @param {Object} opts
 * @param {number} [opts.sampleRate=48000]
 * @param {number} [opts.channels=2]
 * @param {number} [opts.bitDepth=16]
 */
function pcmToWav(pcmData, { sampleRate = 48000, channels = 2, bitDepth = 16 } = {}) {
  const blockAlign = (channels * bitDepth) / 8;
  const byteRate = sampleRate * blockAlign;
  const dataSize = pcmData.length;
  const header = Buffer.alloc(44);

  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // PCM format
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitDepth, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcmData]);
}

module.exports = { pcmToWav };
