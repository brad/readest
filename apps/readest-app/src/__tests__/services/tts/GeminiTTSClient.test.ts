import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { GeminiTTSClient } from '@/services/tts/GeminiTTSClient';
import { GeminiSpeechProvider } from '@/services/tts/providers/gemini';

describe('GeminiTTSClient', () => {
  let client: GeminiTTSClient;

  beforeEach(() => {
    client = new GeminiTTSClient();
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

  test('getVoices returns Gemini prebuilt voice groups', async () => {
    await client.init();
    const groups = await client.getVoices('en-US');
    expect(groups).toHaveLength(1);
    expect(groups[0]!.id).toBe('gemini-tts');
    expect(groups[0]!.name).toBe('Gemini Voice');
    expect(groups[0]!.voices.map((v) => v.id)).toContain('Puck');
  });

  test('shutdown marks client as uninitialized and resets voices', async () => {
    await client.init();
    expect(client.initialized).toBe(true);

    await client.shutdown();
    expect(client.initialized).toBe(false);
    expect(await client.getAllVoices()).toHaveLength(0);
  });
});
