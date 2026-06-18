import { encodeWav } from '@/utils/audio';
import { parseSSMLMarks } from '@/utils/ssml';
import { AppService } from '@/types/system';
import { TTSClient, TTSMessageEvent } from './TTSClient';
import { TTSController } from './TTSController';
import { TTSGranularity, TTSVoice, TTSVoicesGroup } from './types';

interface GeminiTTSPayload {
  text: string;
}

export class GeminiTTSClient implements TTSClient {
  name = 'gemini-tts';
  initialized = false;

  #apiKey = '';
  #primaryLang = 'en';
  #speakingLang = '';
  #currentVoiceId = 'Puck';
  #rate = 1.0;

  #audioElement: HTMLAudioElement | null = null;
  #isPlaying = false;
  controller: TTSController | null = null;
  appService: AppService | null = null;

  #audioCache = new Map<string, string>();

  constructor(apiKey: string, controller?: TTSController, appService?: AppService | null) {
    this.#apiKey = apiKey;
    this.controller = controller ?? null;
    this.appService = appService ?? null;
    if (apiKey) {
      this.initialized = true;
    }
  }

  async init(): Promise<boolean> {
    this.initialized = !!this.#apiKey;
    return this.initialized;
  }

  async shutdown(): Promise<void> {
    await this.stop();
    this.initialized = false;
    this.#audioElement = null;
    this.#audioCache.forEach((url) => URL.revokeObjectURL(url));
    this.#audioCache.clear();
  }

  #getPayload = (text: string) => {
    return { text } as GeminiTTSPayload;
  };

  #createAudioUrlWithRetry = async (
    payload: GeminiTTSPayload,
    signal: AbortSignal,
    maxAttempts = 3,
  ): Promise<string | undefined> => {
    const cacheKey = payload.text;
    if (this.#audioCache.has(cacheKey)) {
      return this.#audioCache.get(cacheKey);
    }

    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (signal.aborted) return undefined;
      try {
        const url = await this.#fetchGeminiAudio(payload.text, signal);
        if (url) {
          this.#audioCache.set(cacheKey, url);
        }
        return url || undefined;
      } catch (err) {
        lastError = err;
        console.warn(`Gemini TTS fetch attempt ${attempt}/${maxAttempts} failed`, err);
        if (attempt < maxAttempts && !signal.aborted) {
          await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
        }
      }
    }
    throw lastError;
  };

  async *speak(ssml: string, signal: AbortSignal, preload = false) {
    if (!this.#apiKey) {
      yield { code: 'error', message: 'Gemini API key is not configured' } as TTSMessageEvent;
      return;
    }

    const { marks } = parseSSMLMarks(ssml, this.#primaryLang);

    if (preload) {
      const maxImmediate = 2;
      for (let i = 0; i < Math.min(maxImmediate, marks.length); i++) {
        if (signal.aborted) break;
        const mark = marks[i]!;
        try {
          await this.#createAudioUrlWithRetry(this.#getPayload(mark.text), signal);
        } catch (err) {
          console.warn('Error preloading Gemini mark', i, err);
        }
      }
      if (marks.length > maxImmediate) {
        (async () => {
          for (let i = maxImmediate; i < marks.length; i++) {
            if (signal.aborted) break;
            const mark = marks[i]!;
            try {
              await this.#createAudioUrlWithRetry(this.#getPayload(mark.text), signal);
            } catch (err) {
              console.warn('Error preloading Gemini mark (bg)', i, err);
            }
          }
        })();
      }

      yield { code: 'end', message: 'Preload finished' } as TTSMessageEvent;
      return;
    }

    await this.stopInternal();
    if (!this.#audioElement) {
      this.#audioElement = new Audio();
    }
    const audio = this.#audioElement;
    audio.setAttribute('x-webkit-airplay', 'deny');
    audio.preload = 'auto';

    for (const mark of marks) {
      this.controller?.dispatchSpeakMark(mark);
      let abortHandler: null | (() => void) = null;
      try {
        this.#speakingLang = mark.language || this.#primaryLang;
        const audioUrl = await this.#createAudioUrlWithRetry(this.#getPayload(mark.text), signal);
        if (process.env.NODE_ENV === 'development') {
          console.debug('Gemini TTS audio URL:', audioUrl);
        }

        if (signal.aborted) {
          yield { code: 'error', message: 'Aborted' } as TTSMessageEvent;
          break;
        }

        yield {
          code: 'boundary',
          message: `Start chunk: ${mark.name}`,
          mark: mark.name,
        } as TTSMessageEvent;

        const result = await new Promise<TTSMessageEvent>((resolve) => {
          const cleanUp = () => {
            audio.onended = null;
            audio.onerror = null;
            audio.src = '';
          };
          let resolved = false;
          const handleEnded = () => {
            if (resolved) return;
            resolved = true;
            cleanUp();
            resolve({ code: 'end', message: `Chunk finished: ${mark.name}` });
          };

          abortHandler = () => {
            cleanUp();
            resolve({ code: 'error', message: 'Aborted' });
          };
          if (signal.aborted) {
            abortHandler();
            return;
          } else {
            signal.addEventListener('abort', abortHandler);
          }

          audio.onended = handleEnded;
          audio.onerror = (e) => {
            cleanUp();
            console.warn('Gemini TTS playback error:', e);
            resolve({ code: 'error', message: 'Audio playback error' });
          };

          this.#isPlaying = true;
          audio.src = audioUrl || '';
          audio.playbackRate = this.#rate;
          audio
            .play()
            .then(() => {
              if (process.env.NODE_ENV === 'development') {
                console.debug('Gemini TTS playback started');
              }
            })
            .catch((err) => {
              if (err.name === 'AbortError') {
                cleanUp();
                resolve({ code: 'end', message: 'Aborted' });
              } else {
                cleanUp();
                console.error('Gemini TTS Playback failed:', err);
                resolve({ code: 'error', message: 'Playback failed: ' + err.message });
              }
            });
        });

        yield result;
        if (result.code === 'error') break;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error('Gemini TTS error:', error);
        yield { code: 'error', message } as TTSMessageEvent;
        break;
      } finally {
        if (abortHandler) {
          signal.removeEventListener('abort', abortHandler);
        }
      }
    }
    await this.stopInternal();
  }

  async #fetchGeminiAudio(text: string, signal: AbortSignal): Promise<string | null> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${this.#apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text }] }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: this.#currentVoiceId,
              },
            },
          },
        },
      }),
      signal,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        `Gemini API error: ${response.status} ${errorData.error?.message || response.statusText}`,
      );
    }

    const data = await response.json();
    if (process.env.NODE_ENV === 'development') {
      console.debug('Gemini TTS API response:', data);
    }
    const audioBase64 = data.candidates?.[0]?.content?.parts?.find(
      (p: { inlineData?: { data: string } }) => p.inlineData,
    )?.inlineData?.data;

    if (!audioBase64) {
      throw new Error('No audio data received from Gemini');
    }

    // Use a more robust base64 to Uint8Array conversion
    const bytes = Uint8Array.from(
      atob(audioBase64.padEnd(audioBase64.length + ((4 - (audioBase64.length % 4)) % 4), '=')),
      (c) => c.charCodeAt(0),
    );

    const wavBytes = encodeWav(bytes, 24000, 1, 16);
    const blob = new Blob([wavBytes as BlobPart], { type: 'audio/wav' });
    return URL.createObjectURL(blob);
  }

  async pause() {
    if (this.#audioElement && this.#isPlaying) {
      await this.#audioElement.pause();
      this.#isPlaying = false;
      return true;
    }
    return false;
  }

  async resume() {
    if (this.#audioElement && !this.#isPlaying) {
      try {
        await this.#audioElement.play();
        this.#isPlaying = true;
        return true;
      } catch (e) {
        console.error('Failed to resume Gemini TTS:', e);
        return false;
      }
    }
    return false;
  }

  async stop() {
    await this.stopInternal();
  }

  private async stopInternal() {
    this.#isPlaying = false;
    if (this.#audioElement) {
      this.#audioElement.pause();
      this.#audioElement.currentTime = 0;
      if (this.#audioElement.onended) {
        this.#audioElement.onended(new Event('stopped'));
      }
      this.#audioElement.src = '';
    }
  }

  setPrimaryLang(lang: string) {
    this.#primaryLang = lang;
  }

  async setRate(rate: number) {
    this.#rate = rate;
    if (this.#audioElement) {
      this.#audioElement.playbackRate = rate;
    }
  }

  async setPitch(_pitch: number) {}

  async setVoice(voice: string) {
    if (voice && this.#currentVoiceId !== voice) {
      this.#currentVoiceId = voice;
      // Clear cache when voice changes
      this.#audioCache.forEach((url) => URL.revokeObjectURL(url));
      this.#audioCache.clear();
    }
  }

  async getAllVoices(): Promise<TTSVoice[]> {
    return [
      { id: 'Aoede', name: 'Aoede', lang: 'en-US' },
      { id: 'Charon', name: 'Charon', lang: 'en-US' },
      { id: 'Fenrir', name: 'Fenrir', lang: 'en-US' },
      { id: 'Kore', name: 'Kore', lang: 'en-US' },
      { id: 'Puck', name: 'Puck', lang: 'en-US' },
    ];
  }

  async getVoices(_lang: string): Promise<TTSVoicesGroup[]> {
    const voices = await this.getAllVoices();
    return [
      {
        id: 'gemini-tts',
        name: 'Gemini TTS',
        voices: voices,
        disabled: !this.initialized,
      },
    ];
  }

  getGranularities(): TTSGranularity[] {
    return ['sentence'];
  }

  getVoiceId(): string {
    return this.#currentVoiceId;
  }

  getSpeakingLang(): string {
    return this.#speakingLang;
  }
}
