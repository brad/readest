import type { TTSCapabilities } from './TTSClient';
import { AppService } from '@/types/system';
import { BufferedTTSClient } from './BufferedTTSClient';
import { BookTTSCacheStore, getTTSCacheConfig } from './providers/bookCacheStore';
import { CachingProvider } from './providers/cache';
import { GeminiSpeechProvider } from './providers/gemini';
import { SpeechProvider } from './providers/types';
import { TTSController } from './TTSController';

export class GeminiTTSClient extends BufferedTTSClient {
  #geminiProvider: GeminiSpeechProvider;

  constructor(controller?: TTSController, appService?: AppService | null) {
    const geminiProvider = new GeminiSpeechProvider();
    let provider: SpeechProvider = geminiProvider;
    const cacheConfig = getTTSCacheConfig();

    if (appService && cacheConfig.enabled) {
      const store = new BookTTSCacheStore(
        appService,
        () => controller?.bookKey?.split('-')[0] || null,
        cacheConfig.budgetMB * 1024 * 1024,
      );
      provider = new CachingProvider(geminiProvider, store);
    }

    super(provider, controller, appService);
    this.#geminiProvider = geminiProvider;
  }

  override async init(): Promise<boolean> {
    this.voices = await this.#geminiProvider.getAllVoices();
    this.initialized = true;
    return true;
  }

  setApiKey(apiKey: string): void {
    this.#geminiProvider.setApiKey(apiKey);
  }

  override getCapabilities(): TTSCapabilities {
    return {
      ...super.getCapabilities(),
      wordBoundaries: false,
    };
  }
}
