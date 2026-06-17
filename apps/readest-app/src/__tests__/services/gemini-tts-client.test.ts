import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { GeminiTTSClient } from '@/services/tts/GeminiTTSClient';
import { TTSController } from '@/services/tts/TTSController';

describe('GeminiTTSClient', () => {
  let client: GeminiTTSClient;
  const apiKey = 'test-api-key';
  let mockController: TTSController;
  // biome-ignore lint/suspicious/noExplicitAny: mock audio element
  let mockAudio: any;

  beforeEach(() => {
    mockController = {
      dispatchSpeakMark: vi.fn(),
    } as unknown as TTSController;

    mockAudio = {
      play: vi.fn().mockResolvedValue(undefined),
      pause: vi.fn(),
      src: '',
      playbackRate: 1.0,
      currentTime: 0,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      setAttribute: vi.fn(),
      onended: null,
      onerror: null,
    };

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [
                  {
                    inlineData: {
                      data: Buffer.from('fake-audio-data').toString('base64'),
                    },
                  },
                ],
              },
            },
          ],
        }),
      }),
    );
    vi.stubGlobal(
      'Audio',
      vi.fn().mockImplementation(function () {
        return mockAudio;
      }),
    );
    vi.stubGlobal(
      'atob',
      vi.fn((s) => Buffer.from(s, 'base64').toString('binary')),
    );
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn().mockReturnValue('blob:test'),
      revokeObjectURL: vi.fn(),
    });
    client = new GeminiTTSClient(apiKey, mockController);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  test('initializes with API key and controller', () => {
    expect(client.initialized).toBe(true);
    expect(client.name).toBe('gemini-tts');
    expect(client.controller).toBe(mockController);
  });

  test('not initialized without API key', () => {
    const emptyClient = new GeminiTTSClient('');
    expect(emptyClient.initialized).toBe(false);
  });

  test('getVoices returns Gemini TTS group', async () => {
    const groups = await client.getVoices('en');
    expect(groups).toHaveLength(1);
    const group = groups[0]!;
    expect(group.id).toBe('gemini-tts');
    expect(group.voices).toHaveLength(5);
  });

  test('speak calls fetch and dispatches marks', async () => {
    const ssml = '<speak><mark name="m1"/>Hello</speak>';
    const signal = new AbortController().signal;
    const iterator = client.speak(ssml, signal);

    // Simulate audio ending immediately
    setTimeout(() => {
      if (mockAudio.onended) {
        mockAudio.onended();
      }
    }, 10);

    const results = [];
    for await (const res of iterator) {
      results.push(res);
    }

    expect(global.fetch).toHaveBeenCalled();
    expect(mockController.dispatchSpeakMark).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'm1', text: 'Hello' }),
    );
    expect(results).toContainEqual(expect.objectContaining({ code: 'boundary', mark: 'm1' }));
    expect(results).toContainEqual(expect.objectContaining({ code: 'end' }));
  });
});
