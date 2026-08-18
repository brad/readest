// Pure PCM helpers for the Web Audio TTS pipeline.
//
// Decoded MP3 "silence" is dithered ringing (roughly 1e-4 to 1e-3 amplitude),
// not zeros, so speech detection uses an amplitude threshold rather than an
// exact-zero test.

export interface SpeechBounds {
  startSec: number;
  endSec: number;
}

// ~-46 dBFS: above decoder dither/ringing, below any audible speech onset.
const DEFAULT_SILENCE_THRESHOLD = 0.005;
// Pads keep a natural attack/release around the detected speech.
const HEAD_PAD_SEC = 0.02;
const TAIL_PAD_SEC = 0.05;

export const findSpeechBounds = (
  samples: Float32Array,
  sampleRate: number,
  threshold = DEFAULT_SILENCE_THRESHOLD,
): SpeechBounds => {
  if (samples.length === 0 || sampleRate <= 0) {
    return { startSec: 0, endSec: 0 };
  }
  let first = -1;
  for (let i = 0; i < samples.length; i++) {
    if (Math.abs(samples[i]!) > threshold) {
      first = i;
      break;
    }
  }
  if (first === -1) {
    // All silence: play as-is rather than scheduling a zero-length chunk.
    return { startSec: 0, endSec: samples.length / sampleRate };
  }
  let last = first;
  for (let i = samples.length - 1; i >= first; i--) {
    if (Math.abs(samples[i]!) > threshold) {
      last = i;
      break;
    }
  }
  const startSec = Math.max(0, first / sampleRate - HEAD_PAD_SEC);
  const endSec = Math.min(samples.length / sampleRate, (last + 1) / sampleRate + TAIL_PAD_SEC);
  return { startSec, endSec };
};

// ~3ms: below one syllable so it is inaudible on speech, but far longer than a
// single sample so the ramp is smooth.
const EDGE_FADE_SEC = 0.003;

// Ramp the first and last samples to zero, in place.
//
// Speech buffers are cut at an amplitude threshold, not a zero crossing, so
// each begins and ends on a non-zero sample. An AudioBufferSourceNode steps
// straight from/to silence at its edges, and that discontinuity clicks/pops
// between sentences. A short linear fade removes the step without audibly
// touching the speech. Mutates the passed array, so callers pass a buffer they
// own (never a subarray view of the decoded audio).
export const applyEdgeFade = (
  samples: Float32Array,
  sampleRate: number,
  fadeSec = EDGE_FADE_SEC,
): void => {
  const n = Math.min(Math.floor(fadeSec * sampleRate), Math.floor(samples.length / 2));
  if (n <= 0) return;
  const last = samples.length - 1;
  for (let i = 0; i < n; i++) {
    const gain = i / n;
    samples[i]! *= gain;
    samples[last - i]! *= gain;
  }
};

export function padBase64(b64: string): string {
  const remainder = b64.length % 4;
  if (remainder === 0) return b64;
  return b64 + '='.repeat(4 - remainder);
}

export function createWavFromPcm(
  pcmData: Uint8Array,
  sampleRate = 24000,
  numChannels = 1,
  bitsPerSample = 16,
): ArrayBuffer {
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = pcmData.byteLength;
  const chunkSize = 36 + dataSize;

  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  // RIFF Chunk Descriptor
  view.setUint32(0, 0x52494646, false); // "RIFF" (Big-endian ASCII)
  view.setUint32(4, chunkSize, true); // Little-endian
  view.setUint32(8, 0x57415645, false); // "WAVE" (Big-endian ASCII)

  // "fmt " Sub-chunk
  view.setUint32(12, 0x666d7420, false); // "fmt "
  view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
  view.setUint16(20, 1, true); // AudioFormat (1 = PCM)
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);

  // "data" Sub-chunk
  view.setUint32(36, 0x64617461, false); // "data"
  view.setUint32(40, dataSize, true);

  // Copy raw PCM sample bytes
  const pcmBytes = new Uint8Array(buffer, 44, dataSize);
  pcmBytes.set(pcmData);

  return buffer;
}
