import {
  DEFAULT_GEMINI_MODEL,
  DEFAULT_GEMINI_VOICE,
  GEMINI_PREBUILT_VOICES,
} from '@/services/constants';
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

export function isAudioContainer(data: Uint8Array, mimeType?: string): boolean {
  if (mimeType) {
    const lower = mimeType.toLowerCase();
    if (
      lower.includes('wav') ||
      lower.includes('mp3') ||
      lower.includes('mpeg') ||
      lower.includes('ogg') ||
      lower.includes('aac') ||
      lower.includes('flac')
    ) {
      return true;
    }
  }
  if (data.length >= 4) {
    // RIFF (WAV)
    if (data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46) {
      return true;
    }
    // ID3 (MP3)
    if (data[0] === 0x49 && data[1] === 0x44 && data[2] === 0x33) {
      return true;
    }
    // MP3 frame sync
    if (data[0] === 0xff && data[1] !== undefined && (data[1] & 0xe0) === 0xe0) {
      return true;
    }
    // OggS
    if (data[0] === 0x4f && data[1] === 0x67 && data[2] === 0x67 && data[3] === 0x53) {
      return true;
    }
  }
  return false;
}

export function parseSampleRate(mimeType?: string, defaultRate = 24000): number {
  if (!mimeType) return defaultRate;
  const match = mimeType.match(/rate=(\d+)/i);
  if (match && match[1]) {
    const parsed = parseInt(match[1], 10);
    if (!Number.isNaN(parsed) && parsed > 0) return parsed;
  }
  return defaultRate;
}

export class GeminiSpeechProvider implements SpeechProvider {
  readonly id = 'gemini-tts';
  readonly label = 'Gemini Voice';
  readonly fallbackVoiceId = DEFAULT_GEMINI_VOICE;
  readonly cacheable = true;

  #apiKey = '';
  #model = DEFAULT_GEMINI_MODEL;

  setApiKey(apiKey: string): void {
    this.#apiKey = apiKey;
  }

  setModel(model: string): void {
    if (model?.trim()) {
      this.#model = model.trim();
    }
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

    const modelName = this.#model.replace(/^models\//, '');
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      modelName,
    )}:generateContent?key=${encodeURIComponent(this.#apiKey)}`;

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

        const mimeType = part.inlineData.mimeType;
        const paddedB64 = padBase64(part.inlineData.data);
        const binaryStr = atob(paddedB64);
        const pcmBytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) {
          pcmBytes[i] = binaryStr.charCodeAt(i);
        }

        let wavArrayBuffer: ArrayBuffer;
        if (isAudioContainer(pcmBytes, mimeType)) {
          wavArrayBuffer = pcmBytes.buffer.slice(
            pcmBytes.byteOffset,
            pcmBytes.byteOffset + pcmBytes.byteLength,
          );
        } else {
          const sampleRate = parseSampleRate(mimeType, 24000);
          wavArrayBuffer = createWavFromPcm(pcmBytes, sampleRate, 1, 16);
        }

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
