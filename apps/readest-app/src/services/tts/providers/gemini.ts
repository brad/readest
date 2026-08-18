import { DEFAULT_GEMINI_VOICE, GEMINI_PREBUILT_VOICES } from '@/services/constants';
import { createWavFromPcm, padBase64 } from '@/services/tts/pcm';
import type { TTSVoice } from '../types';
import {
  SpeechProvider,
  SpeechSynthesisPermanentError,
  SpeechSynthesisRequest,
  SpeechSynthesisResult,
} from './types';

interface GeminiPart {
  text?: string;
  inlineData?: {
    mimeType?: string;
    data?: string;
  };
}

interface GeminiCandidate {
  content?: {
    parts?: GeminiPart[];
  };
}

interface GeminiResponse {
  candidates?: GeminiCandidate[];
}

export function parseRetryAfterHeader(headerValue: string | null): number | null {
  if (!headerValue) return null;
  const trimmed = headerValue.trim();

  // Try parsing as integer seconds
  if (/^\d+$/.test(trimmed)) {
    const seconds = parseInt(trimmed, 10);
    return Number.isNaN(seconds) ? null : seconds * 1000;
  }

  // Try parsing as HTTP-Date
  const dateMs = Date.parse(trimmed);
  if (!Number.isNaN(dateMs)) {
    const delayMs = dateMs - Date.now();
    return delayMs > 0 ? delayMs : 0;
  }

  return null;
}

export function calculateBackoffWithJitter(
  attempt: number,
  baseDelayMs = 500,
  maxDelayMs = 10000,
): number {
  const temp = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt - 1));
  return Math.floor(Math.random() * temp);
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      return;
    }

    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'));
    };

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export class GeminiSpeechProvider implements SpeechProvider {
  readonly id = 'gemini-tts';
  readonly label = 'Gemini Voice';
  readonly fallbackVoiceId = DEFAULT_GEMINI_VOICE;
  readonly cacheable = true;

  #apiKey = '';

  setApiKey(apiKey: string): void {
    this.#apiKey = apiKey;
  }

  async init(): Promise<boolean> {
    return true;
  }

  async getAllVoices(): Promise<TTSVoice[]> {
    return GEMINI_PREBUILT_VOICES.map((v) => ({
      id: v.id,
      name: v.name,
      lang: 'en-US',
    }));
  }

  async synthesize(
    req: SpeechSynthesisRequest,
    signal: AbortSignal,
    maxAttempts = 3,
  ): Promise<SpeechSynthesisResult> {
    if (!this.#apiKey) {
      throw new SpeechSynthesisPermanentError('Gemini API key is missing.');
    }

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(
      this.#apiKey,
    )}`;

    const payload = {
      contents: [
        {
          parts: [{ text: req.text }],
        },
      ],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: req.voice || DEFAULT_GEMINI_VOICE,
            },
          },
        },
      },
    };

    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (signal.aborted) {
        throw signal.reason ?? new DOMException('Aborted', 'AbortError');
      }

      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal,
        });

        if (!response.ok) {
          const errText = await response.text().catch(() => '');
          const status = response.status;

          // Permanent Errors: 400, 401, 403, 404
          if (status === 400 || status === 401 || status === 403 || status === 404) {
            throw new SpeechSynthesisPermanentError(
              `Gemini API key or request error (${status}): ${errText}`,
            );
          }

          // Transient error
          const err = new Error(`Gemini API HTTP ${status}: ${errText}`);

          if (attempt < maxAttempts) {
            let delayMs: number | null = null;
            if (status === 429 || status === 503) {
              const retryAfterHeader = response.headers.get('Retry-After');
              delayMs = parseRetryAfterHeader(retryAfterHeader);
            }
            if (delayMs === null) {
              delayMs = calculateBackoffWithJitter(attempt);
            }

            await sleep(delayMs, signal);
            continue;
          }

          throw err;
        }

        const json = (await response.json()) as GeminiResponse;
        const candidate = json.candidates?.[0];
        const part = candidate?.content?.parts?.find((p: GeminiPart) => p.inlineData?.data);

        if (!part?.inlineData?.data) {
          throw new SpeechSynthesisPermanentError('No audio data received from Gemini API.');
        }

        const paddedB64 = padBase64(part.inlineData.data);
        const binaryStr = atob(paddedB64);
        const pcmBytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) {
          pcmBytes[i] = binaryStr.charCodeAt(i);
        }

        const wavArrayBuffer = createWavFromPcm(pcmBytes, 24000, 1, 16);

        return {
          audio: wavArrayBuffer,
          boundaries: [],
        };
      } catch (err) {
        if (err instanceof SpeechSynthesisPermanentError) {
          throw err;
        }
        if (signal.aborted) {
          throw err;
        }

        lastError = err;

        if (attempt < maxAttempts) {
          const delayMs = calculateBackoffWithJitter(attempt);
          await sleep(delayMs, signal);
        }
      }
    }

    throw lastError;
  }
}
