import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import type { TTSMessageEvent } from '@/services/tts/TTSClient';
import type { TTSController } from '@/services/tts/TTSController';
import type { GeminiTTSClient as GeminiTTSClientClass } from '@/services/tts/GeminiTTSClient';
import type { GeminiSpeechProvider as GeminiSpeechProviderClass } from '@/services/tts/providers/gemini';
import type { AppService } from '@/types/system';
import type { MockInstance } from 'vitest';
import { FakeAudioContext } from '../tts-fake-audio';

let parsedMarks: Array<{ name: string; text: string; language: string }> = [];

vi.mock('@/utils/ssml', () => ({
  parseSSMLMarks: vi.fn(() => ({ marks: parsedMarks })),
}));

vi.mock('@/utils/misc', () => ({
  getUserLocale: vi.fn((lang: string) => (lang === 'en' ? 'en-US' : lang)),
  getOSPlatform: vi.fn(() => 'macos'),
  stubTranslation: (key: string) => key,
}));

vi.mock('@/services/environment', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/environment')>()),
  isTauriAppPlatform: () => false,
}));

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const audioOf = (seconds: number) => ({
  audio: new ArrayBuffer(Math.round(seconds * 24000)),
  boundaries: [],
});

interface MockController {
  dispatchSpeakMark: ReturnType<typeof vi.fn>;
  prepareSpeakWords: ReturnType<typeof vi.fn>;
  dispatchSpeakWord: ReturnType<typeof vi.fn>;
  bookKey?: string;
}

describe('GeminiTTSClient', () => {
  let GeminiTTSClient: typeof GeminiTTSClientClass;
  let GeminiSpeechProvider: typeof GeminiSpeechProviderClass;
  let client: GeminiTTSClientClass;
  let controller: MockController;

  beforeEach(async () => {
    vi.resetModules();
    FakeAudioContext.instances = [];
    vi.stubGlobal('AudioContext', FakeAudioContext);

    controller = {
      dispatchSpeakMark: vi.fn().mockReturnValue({ sectionIndex: 0, sentenceIndex: 0 }),
      prepareSpeakWords: vi.fn(),
      dispatchSpeakWord: vi.fn(),
    };

    const providerMod = await import('@/services/tts/providers/gemini');
    GeminiSpeechProvider = providerMod.GeminiSpeechProvider;

    const clientMod = await import('@/services/tts/GeminiTTSClient');
    GeminiTTSClient = clientMod.GeminiTTSClient;

    client = new GeminiTTSClient(controller as unknown as TTSController);

    parsedMarks = [
      { name: '0', text: 'First sentence.', language: 'en' },
      { name: '1', text: 'Second sentence.', language: 'en' },
      { name: '2', text: 'Third sentence.', language: 'en' },
    ];
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('constructor initializes name to gemini-tts', () => {
    expect(client.name).toBe('gemini-tts');
  });

  test('starts uninitialized', () => {
    expect(client.initialized).toBe(false);
  });

  test('init populates voices and sets initialized to true', async () => {
    const result = await client.init();
    expect(result).toBe(true);
    expect(client.initialized).toBe(true);

    const voices = await client.getAllVoices();
    expect(voices.length).toBeGreaterThan(0);
    expect(voices.map((v) => v.id)).toContain('Puck');
  });

  test('setApiKey propagates API key to underlying provider', () => {
    const setApiKeySpy = vi.spyOn(GeminiSpeechProvider.prototype, 'setApiKey');
    const localClient = new GeminiTTSClient();
    localClient.setApiKey('test-gemini-key');
    expect(setApiKeySpy).toHaveBeenCalledWith('test-gemini-key');
  });

  test('setModel propagates model name to underlying provider', () => {
    const setModelSpy = vi.spyOn(GeminiSpeechProvider.prototype, 'setModel');
    const localClient = new GeminiTTSClient();
    localClient.setModel('gemini-2.0-flash');
    expect(setModelSpy).toHaveBeenCalledWith('gemini-2.0-flash');
  });

  test('getVoices returns Gemini prebuilt voice groups', async () => {
    await client.init();
    const groups = await client.getVoices('en-US');
    expect(groups).toHaveLength(1);
    expect(groups[0]!.id).toBe('gemini-tts');
    expect(groups[0]!.name).toBe('Gemini Voice');
    expect(groups[0]!.voices.map((v) => v.id)).toContain('Puck');
  });

  test('getCapabilities returns wordBoundaries false for Gemini Voice', () => {
    const caps = client.getCapabilities();
    expect(caps.wordBoundaries).toBe(false);
    expect(caps.mediaClock).toBe(true);
    expect(caps.gapControl).toBe(true);
  });

  test('shutdown marks client as uninitialized and resets voices', async () => {
    await client.init();
    expect(client.initialized).toBe(true);

    await client.shutdown();
    expect(client.initialized).toBe(false);
    expect(await client.getAllVoices()).toHaveLength(0);
  });

  describe('Audio Caching, Pre-downloading and Compaction', () => {
    let mockAppService: AppService;
    let cachedClient: GeminiTTSClientClass;
    let synthesizeSpy: MockInstance;

    beforeEach(async () => {
      const { NodeDatabaseService } = await import('@/services/database/nodeDatabaseService');
      const db = await NodeDatabaseService.open(':memory:');
      mockAppService = {
        createDir: vi.fn().mockResolvedValue(undefined),
        openDatabase: vi.fn().mockResolvedValue(db),
      } as unknown as AppService;

      controller.bookKey = 'book123-hash';

      cachedClient = new GeminiTTSClient(controller as unknown as TTSController, mockAppService);
      await cachedClient.init();
      cachedClient.setApiKey('test-key');

      synthesizeSpy = vi
        .spyOn(GeminiSpeechProvider.prototype, 'synthesize')
        .mockImplementation(async () => audioOf(1));
    });

    test('canDownload returns false without appService and true with appService', () => {
      expect(client.canDownload()).toBe(false);
      expect(cachedClient.canDownload()).toBe(true);
    });

    test('caching provider caches synthesized audio and avoids duplicate API calls on cache hit', async () => {
      const signal = new AbortController().signal;

      // First call: cache miss, triggers synthesize
      for await (const _ of cachedClient.speak('<ssml/>', signal, true)) {
        void _;
      }
      await flush();

      expect(synthesizeSpy).toHaveBeenCalledTimes(3);

      synthesizeSpy.mockClear();

      // Second call: cache hit, no new synthesize calls
      for await (const _ of cachedClient.speak('<ssml/>', signal, true)) {
        void _;
      }
      await flush();

      expect(synthesizeSpy).toHaveBeenCalledTimes(0);
    });

    test('warmSentence synthesizes and caches sentence for offline reading', async () => {
      const result = await cachedClient.warmSentence(0, 0, 'en', 'Offline sentence text');
      expect(result).toBe(true);
      expect(synthesizeSpy).toHaveBeenCalledTimes(1);

      // Re-warming the same sentence hits the cache and returns true without re-synthesizing
      synthesizeSpy.mockClear();
      const cachedResult = await cachedClient.warmSentence(0, 0, 'en', 'Offline sentence text');
      expect(cachedResult).toBe(true);
      expect(synthesizeSpy).toHaveBeenCalledTimes(0);
    });

    test('compactCache, registerSectionManifest, and getSectionDurations execute cleanly', async () => {
      cachedClient.registerSectionManifest(0, ['0:First sentence.', '1:Second sentence.']);
      await cachedClient.warmSentence(0, 0, 'en', 'First sentence.');
      await cachedClient.warmSentence(0, 1, 'en', 'Second sentence.');

      const durations = await cachedClient.getSectionDurations(0);
      expect(durations).toBeDefined();

      await expect(cachedClient.compactCache()).resolves.toBeUndefined();
    });
  });

  describe('Preloading and Playback', () => {
    const collectSpeak = (client: GeminiTTSClientClass, signal: AbortSignal, preload = false) => {
      const events: TTSMessageEvent[] = [];
      const done = (async () => {
        for await (const event of client.speak('<ssml/>', signal, preload)) {
          events.push(event);
        }
      })();
      return { events, done };
    };

    const ctx = () => FakeAudioContext.instances[0]!;

    test('speak with preload=true pre-fetches marks and yields preload finished', async () => {
      const synthesizeSpy = vi
        .spyOn(GeminiSpeechProvider.prototype, 'synthesize')
        .mockImplementation(async () => audioOf(1));

      await client.init();
      client.setApiKey('test-key');

      const abortController = new AbortController();
      const { events, done } = collectSpeak(client, abortController.signal, true);

      await done;

      expect(events).toEqual([{ code: 'end', message: 'Preload finished' }]);
      await flush();
      expect(synthesizeSpy).toHaveBeenCalledTimes(3);
    });

    test('speak with preload=false plays sentences and dispatches marks on chunk-start', async () => {
      vi.spyOn(GeminiSpeechProvider.prototype, 'synthesize').mockImplementation(async () =>
        audioOf(1),
      );

      await client.init();
      client.setApiKey('test-key');

      const abortController = new AbortController();
      const { events, done } = collectSpeak(client, abortController.signal, false);

      await flush();
      await flush();

      expect(ctx().sources.length).toBeGreaterThanOrEqual(1);
      expect(controller.dispatchSpeakMark).toHaveBeenCalledWith(parsedMarks[0]);

      await ctx().advanceTo(1.1);
      await flush();

      expect(controller.dispatchSpeakMark).toHaveBeenCalledWith(parsedMarks[1]);

      await ctx().advanceTo(5);
      await done;

      const boundaryEvents = events.filter((e) => e.code === 'boundary');
      expect(boundaryEvents).toHaveLength(3);
      expect(events.at(-1)).toEqual({ code: 'end', message: 'Speak finished' });
    });

    test('aborting mid-stream halts playback and yields error Aborted', async () => {
      vi.spyOn(GeminiSpeechProvider.prototype, 'synthesize').mockImplementation(async () =>
        audioOf(1),
      );

      await client.init();
      client.setApiKey('test-key');

      const abortController = new AbortController();
      const { events, done } = collectSpeak(client, abortController.signal, false);

      await flush();
      await flush();

      abortController.abort();
      await done;

      expect(events.at(-1)).toMatchObject({ code: 'error', message: 'Aborted' });
      expect(ctx().sources.every((s) => s.stopped)).toBe(true);
    });

    test('yields error code when MAX_CONSECUTIVE_SKIPS is exceeded', async () => {
      parsedMarks = [
        { name: '0', text: 'Sentence 1', language: 'en' },
        { name: '1', text: 'Sentence 2', language: 'en' },
        { name: '2', text: 'Sentence 3', language: 'en' },
        { name: '3', text: 'Sentence 4', language: 'en' },
        { name: '4', text: 'Sentence 5', language: 'en' },
      ];

      vi.spyOn(GeminiSpeechProvider.prototype, 'synthesize').mockRejectedValue(
        new Error('Synthesis failed'),
      );

      await client.init();
      client.setApiKey('test-key');

      const abortController = new AbortController();
      const { events, done } = collectSpeak(client, abortController.signal, false);

      await done;

      const errorEvent = events.find((e) => e.code === 'error');
      expect(errorEvent).toBeDefined();
      expect(errorEvent?.message).toBe('Synthesis failed');
    });
  });
});
