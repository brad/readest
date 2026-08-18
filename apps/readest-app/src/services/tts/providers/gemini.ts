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

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      if (response.status === 400 || response.status === 403) {
        throw new SpeechSynthesisPermanentError(
          `Gemini API key or request error (${response.status}): ${errText}`,
        );
      }
      throw new Error(`Gemini API HTTP ${response.status}: ${errText}`);
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
  }
}
