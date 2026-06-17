import { encodeWav } from '@/utils/audio';
import { parseSSMLMarks } from '@/utils/ssml';
import { TTSClient, TTSMessageEvent } from './TTSClient';
import { TTSGranularity, TTSVoice, TTSVoicesGroup } from './types';

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

  constructor(apiKey: string) {
    this.#apiKey = apiKey;
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
  }

  async *speak(ssml: string, signal: AbortSignal, preload = false) {
    if (!this.#apiKey) {
      yield { code: 'error', message: 'Gemini API key is not configured' } as TTSMessageEvent;
      return;
    }

    const { marks } = parseSSMLMarks(ssml, this.#primaryLang);

    if (preload) {
      yield { code: 'end', message: 'Preload finished' } as TTSMessageEvent;
      return;
    }

    await this.stop();
    if (!this.#audioElement) {
      this.#audioElement = new Audio();
    }
    const audio = this.#audioElement;

    for (const mark of marks) {
      if (signal.aborted) break;

      try {
        const audioUrl = await this.#fetchGeminiAudio(mark.text, signal);
        if (!audioUrl) continue;

        yield {
          code: 'boundary',
          message: `Start chunk: ${mark.name}`,
          mark: mark.name,
        } as TTSMessageEvent;

        const result = await new Promise<TTSMessageEvent>((resolve) => {
          const cleanUp = () => {
            audio.onended = null;
            audio.onerror = null;
            if (audio.src.startsWith('blob:')) {
              URL.revokeObjectURL(audio.src);
            }
            audio.src = '';
          };

          const handleEnded = () => {
            cleanUp();
            resolve({ code: 'end', message: `Chunk finished: ${mark.name}` });
          };

          const handleError = (e: string | Event) => {
            cleanUp();
            console.error('Gemini TTS playback error:', e);
            resolve({ code: 'error', message: 'Audio playback error' });
          };

          audio.onended = handleEnded;
          audio.onerror = handleError;

          const abortHandler = () => {
            cleanUp();
            resolve({ code: 'error', message: 'Aborted' });
          };

          signal.addEventListener('abort', abortHandler, { once: true });

          this.#isPlaying = true;
          audio.src = audioUrl;
          audio.playbackRate = this.#rate;
          audio.play().catch((err) => {
            if (err.name !== 'AbortError') {
              cleanUp();
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
      }
    }
  }

  async #fetchGeminiAudio(text: string, signal: AbortSignal): Promise<string | null> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${this.#apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text }] }],
        generationConfig: {
          response_modalities: ['AUDIO'],
          speech_config: {
            voice_config: {
              prebuilt_voice_config: {
                voice_name: this.#currentVoiceId,
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
    const audioBase64 = data.candidates?.[0]?.content?.parts?.find(
      (p: { inlineData?: { data: string } }) => p.inlineData,
    )?.inlineData?.data;

    if (!audioBase64) {
      throw new Error('No audio data received from Gemini');
    }

    const binaryString = atob(audioBase64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    const wavBytes = encodeWav(bytes, 24000, 1, 16);
    const blob = new Blob([wavBytes as BlobPart], { type: 'audio/wav' });
    return URL.createObjectURL(blob);
  }

  async pause() {
    if (this.#audioElement && this.#isPlaying) {
      this.#audioElement.pause();
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
    this.#isPlaying = false;
    if (this.#audioElement) {
      this.#audioElement.pause();
      this.#audioElement.currentTime = 0;
      if (this.#audioElement.src.startsWith('blob:')) {
        URL.revokeObjectURL(this.#audioElement.src);
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
    if (voice) {
      this.#currentVoiceId = voice;
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
