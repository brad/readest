import { describe, expect, it } from 'vitest';
import { createWavFromPcm, padBase64 } from '@/services/tts/pcm';

describe('audio utilities', () => {
  describe('padBase64', () => {
    it('returns untouched string if length is multiple of 4', () => {
      expect(padBase64('abcd')).toBe('abcd');
      expect(padBase64('abcdefgh')).toBe('abcdefgh');
    });

    it('adds single = padding when remainder is 3 (length % 4 == 3)', () => {
      expect(padBase64('abc')).toBe('abc=');
    });

    it('adds double == padding when remainder is 2 (length % 4 == 2)', () => {
      expect(padBase64('ab')).toBe('ab==');
    });

    it('adds triple === padding when remainder is 1 (length % 4 == 1)', () => {
      expect(padBase64('a')).toBe('a===');
    });
  });

  describe('createWavFromPcm', () => {
    it('generates a valid 44-byte RIFF/WAVE header and appends PCM data', () => {
      const pcmData = new Uint8Array([0x01, 0x02, 0x03, 0x04]);
      const buffer = createWavFromPcm(pcmData, 24000, 1, 16);

      expect(buffer.byteLength).toBe(44 + 4);

      const view = new DataView(buffer);

      // Check "RIFF"
      const riff = String.fromCharCode(
        view.getUint8(0),
        view.getUint8(1),
        view.getUint8(2),
        view.getUint8(3),
      );
      expect(riff).toBe('RIFF');

      // Check ChunkSize (36 + 4 = 40)
      expect(view.getUint32(4, true)).toBe(40);

      // Check "WAVE"
      const wave = String.fromCharCode(
        view.getUint8(8),
        view.getUint8(9),
        view.getUint8(10),
        view.getUint8(11),
      );
      expect(wave).toBe('WAVE');

      // Check "fmt "
      const fmt = String.fromCharCode(
        view.getUint8(12),
        view.getUint8(13),
        view.getUint8(14),
        view.getUint8(15),
      );
      expect(fmt).toBe('fmt ');

      // Subchunk1Size = 16
      expect(view.getUint32(16, true)).toBe(16);

      // AudioFormat = 1 (PCM)
      expect(view.getUint16(20, true)).toBe(1);

      // NumChannels = 1
      expect(view.getUint16(22, true)).toBe(1);

      // SampleRate = 24000
      expect(view.getUint32(24, true)).toBe(24000);

      // ByteRate = (24000 * 1 * 16) / 8 = 48000
      expect(view.getUint32(28, true)).toBe(48000);

      // BlockAlign = (1 * 16) / 8 = 2
      expect(view.getUint16(32, true)).toBe(2);

      // BitsPerSample = 16
      expect(view.getUint16(34, true)).toBe(16);

      // Check "data"
      const dataHeader = String.fromCharCode(
        view.getUint8(36),
        view.getUint8(37),
        view.getUint8(38),
        view.getUint8(39),
      );
      expect(dataHeader).toBe('data');

      // Subchunk2Size = 4
      expect(view.getUint32(40, true)).toBe(4);

      // Verify copied PCM bytes
      const resultPcm = new Uint8Array(buffer, 44, 4);
      expect(Array.from(resultPcm)).toEqual([0x01, 0x02, 0x03, 0x04]);
    });
  });
});
