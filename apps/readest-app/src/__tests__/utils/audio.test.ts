import { describe, it, expect } from 'vitest';
import { encodeWav } from '../../utils/audio';

describe('encodeWav', () => {
  it('should create a valid WAV header', () => {
    const pcmData = new Uint8Array([0, 1, 2, 3]);
    const sampleRate = 24000;
    const numChannels = 1;
    const bitsPerSample = 16;

    const result = encodeWav(pcmData, sampleRate, numChannels, bitsPerSample);

    // Check RIFF header
    expect(String.fromCharCode(...result.slice(0, 4))).toBe('RIFF');
    // Check file size (36 + pcmData.length = 40)
    const view = new DataView(result.buffer);
    expect(view.getUint32(4, true)).toBe(40);
    // Check WAVE header
    expect(String.fromCharCode(...result.slice(8, 12))).toBe('WAVE');
    // Check fmt header
    expect(String.fromCharCode(...result.slice(12, 16))).toBe('fmt ');
    // Check sample rate
    expect(view.getUint32(24, true)).toBe(24000);
    // Check data header
    expect(String.fromCharCode(...result.slice(36, 40))).toBe('data');
    // Check data length
    expect(view.getUint32(40, true)).toBe(4);
    // Check PCM data
    expect(Array.from(result.slice(44))).toEqual([0, 1, 2, 3]);
  });
});
