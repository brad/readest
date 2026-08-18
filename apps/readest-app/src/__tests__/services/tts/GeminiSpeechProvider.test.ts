import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GeminiSpeechProvider } from '@/services/tts/providers/gemini';
import { SpeechSynthesisPermanentError } from '@/services/tts/providers/types';

describe('GeminiSpeechProvider', () => {
  let provider: GeminiSpeechProvider;

  beforeEach(() => {
    provider = new GeminiSpeechProvider();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('has correct provider metadata', () => {
    expect(provider.id).toBe('gemini-tts');
    expect(provider.label).toBe('Gemini Voice');
    expect(provider.fallbackVoiceId).toBe('Puck');
    expect(provider.cacheable).toBe(true);
  });

  it('throws SpeechSynthesisPermanentError if API key is not set', async () => {
    const controller = new AbortController();
    await expect(
      provider.synthesize(
        { lang: 'en-US', text: 'Hello', voice: 'Puck', pitch: 1.0 },
        controller.signal,
      ),
    ).rejects.toThrow(SpeechSynthesisPermanentError);
  });

  it('sends camelCase request payload to Gemini REST API', async () => {
    provider.setApiKey('test-key');

    // Return dummy PCM base64 string "AQID" (bytes [1, 2, 3])
    const fakePcmB64 = 'AQID';
    const mockResponse = {
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                {
                  inlineData: {
                    mimeType: 'audio/pcm;rate=24000',
                    data: fakePcmB64,
                  },
                },
              ],
            },
          },
        ],
      }),
    };

    const fetchMock = vi.fn().mockResolvedValue(mockResponse);
    vi.stubGlobal('fetch', fetchMock);

    const controller = new AbortController();
    const result = await provider.synthesize(
      { lang: 'en-US', text: 'Hello world', voice: 'Kore', pitch: 1.0 },
      controller.signal,
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];

    expect(url).toContain(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=test-key',
    );
    expect(options.method).toBe('POST');
    expect(options.headers).toEqual({ 'Content-Type': 'application/json' });

    const payload = JSON.parse(options.body);

    // Strict camelCase verification
    expect(payload.contents).toEqual([{ parts: [{ text: 'Hello world' }] }]);
    expect(payload.generationConfig.responseModalities).toEqual(['AUDIO']);
    expect(payload.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe(
      'Kore',
    );

    // Check generated audio WAV buffer (44 header + 3 PCM bytes = 47)
    expect(result.audio.byteLength).toBe(47);
    expect(result.boundaries).toEqual([]);
  });

  it('throws SpeechSynthesisPermanentError on HTTP 400 or 403', async () => {
    provider.setApiKey('invalid-key');

    const mockResponse = {
      ok: false,
      status: 400,
      text: async () => 'API key invalid',
    };

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse));

    const controller = new AbortController();
    await expect(
      provider.synthesize(
        { lang: 'en-US', text: 'Hello', voice: 'Puck', pitch: 1.0 },
        controller.signal,
      ),
    ).rejects.toThrow(SpeechSynthesisPermanentError);
  });

  it('throws transient Error on HTTP 500 or 503', async () => {
    provider.setApiKey('test-key');

    const mockResponse = {
      ok: false,
      status: 503,
      text: async () => 'Service Unavailable',
    };

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse));

    const controller = new AbortController();
    const promise = provider.synthesize(
      { lang: 'en-US', text: 'Hello', voice: 'Puck', pitch: 1.0 },
      controller.signal,
    );

    await expect(promise).rejects.toThrow('Gemini API HTTP 503: Service Unavailable');
    await expect(promise).rejects.not.toBeInstanceOf(SpeechSynthesisPermanentError);
  });
});
