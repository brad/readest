import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GeminiSpeechProvider,
  calculateBackoffWithJitter,
  parseRetryAfterHeader,
  sleep,
} from '@/services/tts/providers/gemini';
import { SpeechSynthesisPermanentError } from '@/services/tts/providers/types';

describe('Gemini Utilities', () => {
  describe('parseRetryAfterHeader', () => {
    it('returns null for null, empty or invalid header values', () => {
      expect(parseRetryAfterHeader(null)).toBeNull();
      expect(parseRetryAfterHeader('')).toBeNull();
      expect(parseRetryAfterHeader('   ')).toBeNull();
      expect(parseRetryAfterHeader('invalid-date-string')).toBeNull();
    });

    it('parses integer seconds correctly', () => {
      expect(parseRetryAfterHeader('5')).toBe(5000);
      expect(parseRetryAfterHeader('120')).toBe(120000);
    });

    it('parses valid HTTP-Date correctly', () => {
      const futureMs = Date.now() + 10000;
      const httpDate = new Date(futureMs).toUTCString();
      const parsed = parseRetryAfterHeader(httpDate);
      expect(parsed).not.toBeNull();
      expect(parsed!).toBeGreaterThan(0);
      expect(parsed!).toBeLessThanOrEqual(10000);
    });

    it('returns 0 for past HTTP-Date', () => {
      const pastMs = Date.now() - 10000;
      const httpDate = new Date(pastMs).toUTCString();
      expect(parseRetryAfterHeader(httpDate)).toBe(0);
    });
  });

  describe('calculateBackoffWithJitter', () => {
    it('returns delay within [0, baseDelay * 2^(attempt-1)]', () => {
      for (let i = 0; i < 50; i++) {
        const delay1 = calculateBackoffWithJitter(1, 500, 10000);
        expect(delay1).toBeGreaterThanOrEqual(0);
        expect(delay1).toBeLessThanOrEqual(500);

        const delay2 = calculateBackoffWithJitter(2, 500, 10000);
        expect(delay2).toBeGreaterThanOrEqual(0);
        expect(delay2).toBeLessThanOrEqual(1000);
      }
    });

    it('caps delay at maxDelayMs', () => {
      for (let i = 0; i < 20; i++) {
        const delay = calculateBackoffWithJitter(10, 500, 2000);
        expect(delay).toBeGreaterThanOrEqual(0);
        expect(delay).toBeLessThanOrEqual(2000);
      }
    });
  });

  describe('sleep', () => {
    it('resolves after specified duration', async () => {
      const start = Date.now();
      await sleep(50);
      expect(Date.now() - start).toBeGreaterThanOrEqual(40);
    });

    it('rejects immediately if signal is already aborted', async () => {
      const controller = new AbortController();
      controller.abort(new Error('Pre-aborted'));
      await expect(sleep(1000, controller.signal)).rejects.toThrow('Pre-aborted');
    });

    it('rejects when signal aborts during sleep', async () => {
      const controller = new AbortController();
      const sleepPromise = sleep(1000, controller.signal);
      setTimeout(() => controller.abort(new Error('Aborted during sleep')), 30);
      await expect(sleepPromise).rejects.toThrow('Aborted during sleep');
    });
  });
});

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
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=test-key',
    );
    expect(options.method).toBe('POST');
    expect(options.headers).toEqual({ 'Content-Type': 'application/json' });

    const payload = JSON.parse(options.body);

    expect(payload.contents).toEqual([{ parts: [{ text: 'Hello world' }] }]);
    expect(payload.generationConfig.responseModalities).toEqual(['AUDIO']);
    expect(payload.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe(
      'Kore',
    );

    expect(result.audio.byteLength).toBe(47);
    expect(result.boundaries).toEqual([]);
  });

  it('throws SpeechSynthesisPermanentError immediately on HTTP 400, 401, 403, 404', async () => {
    provider.setApiKey('invalid-key');

    const statuses = [400, 401, 403, 404];

    for (const status of statuses) {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status,
        text: async () => `Error ${status}`,
      });
      vi.stubGlobal('fetch', fetchMock);

      const controller = new AbortController();
      await expect(
        provider.synthesize(
          { lang: 'en-US', text: 'Hello', voice: 'Puck', pitch: 1.0 },
          controller.signal,
        ),
      ).rejects.toThrow(SpeechSynthesisPermanentError);

      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  });

  it('retries on HTTP 429 and succeeds on subsequent attempt', async () => {
    provider.setApiKey('test-key');

    const fakePcmB64 = 'AQID';
    const rateLimitResponse = {
      ok: false,
      status: 429,
      headers: new Headers({ 'Retry-After': '1' }),
      text: async () => 'Rate limit exceeded',
    };

    const successResponse = {
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

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(rateLimitResponse)
      .mockResolvedValueOnce(successResponse);

    vi.stubGlobal('fetch', fetchMock);

    const controller = new AbortController();
    const result = await provider.synthesize(
      { lang: 'en-US', text: 'Hello', voice: 'Puck', pitch: 1.0 },
      controller.signal,
      2,
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.audio.byteLength).toBe(47);
  });

  it('throws transient Error after exhausting retries on HTTP 500 or 503', async () => {
    provider.setApiKey('test-key');

    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => 'Service Unavailable',
    });

    vi.stubGlobal('fetch', fetchMock);

    const controller = new AbortController();
    const promise = provider.synthesize(
      { lang: 'en-US', text: 'Hello', voice: 'Puck', pitch: 1.0 },
      controller.signal,
      2,
    );

    await expect(promise).rejects.toThrow('Gemini API HTTP 503: Service Unavailable');
    await expect(promise).rejects.not.toBeInstanceOf(SpeechSynthesisPermanentError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
