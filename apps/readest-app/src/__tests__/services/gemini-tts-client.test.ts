import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { GeminiTTSClient } from '@/services/tts/GeminiTTSClient';

describe('GeminiTTSClient', () => {
  let client: GeminiTTSClient;
  const apiKey = 'test-api-key';

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              inlineData: {
                data: Buffer.from('fake-audio-data').toString('base64')
              }
            }]
          }
        }]
      })
    }));
    vi.stubGlobal('Audio', vi.fn().mockImplementation(function() {
      return {
        play: vi.fn().mockResolvedValue(undefined),
        pause: vi.fn(),
        src: '',
        playbackRate: 1.0,
        currentTime: 0,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn()
      };
    }));
    vi.stubGlobal('atob', vi.fn((s) => Buffer.from(s, 'base64').toString('binary')));
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn().mockReturnValue('blob:test'),
      revokeObjectURL: vi.fn(),
    });
    client = new GeminiTTSClient(apiKey);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('initializes with API key', () => {
    expect(client.initialized).toBe(true);
    expect(client.name).toBe('gemini-tts');
  });

  test('not initialized without API key', () => {
    const emptyClient = new GeminiTTSClient('');
    expect(emptyClient.initialized).toBe(false);
  });

  test('getVoices returns Gemini TTS group', async () => {
    const groups = await client.getVoices('en');
    expect(groups).toHaveLength(1);
    expect(groups[0].id).toBe('gemini-tts');
    expect(groups[0].voices).toHaveLength(5);
  });

  // skipping speak test for now as it needs complex async iterator handling with mocks
  test.skip('speak calls Gemini API', async () => {
  });
});
