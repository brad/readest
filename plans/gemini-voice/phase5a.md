# Phase 5A Specification & Implementation Plan: Unit & Provider Testing

**Target Plan File**: `plans/gemini-voice/phase5a.md`
**Parent Plan**: `plans/gemini-voice/overview.md`
**Status**: Draft / Ready for Implementation

---

## 1. Overview & Objectives

Phase 5A focuses on low-level unit testing and provider-level validation for **Gemini Voice** in Readest. It covers raw audio utility conversion, REST API request schema serialization, error code classification, rate-limiting exponential backoff, default settings constants, and credential sanitization during backup exports.

By the end of Phase 5A:
1. **Audio Utilities**: `padBase64` and `createWavFromPcm` are thoroughly tested for edge cases (unpadded, 1-pad, 2-pad, byte header layout).
2. **Speech Provider**: `GeminiSpeechProvider` REST request formatting (strict `camelCase` compliance), response parsing, permanent vs transient error classification (`SpeechSynthesisPermanentError`), and `Retry-After` header parsing (seconds and HTTP-Date) are verified.
3. **Configuration & Security Defaults**: Default TTS settings in `DEFAULT_TTS_CONFIG` and credential sanitization in `backupService` are tested to ensure `geminiApiKey` is omitted in plain exports.

---

## 2. Target Test Files & Coverage Strategy

| Test File Path | Description & Test Scenarios |
| --- | --- |
| `apps/readest-app/src/__tests__/services/tts-pcm.test.ts` | Test `padBase64` with unpadded, 1-char, 2-char missing padding strings. Test `createWavFromPcm` 44-byte RIFF/WAVE header offsets (RIFF, WAVE, fmt, data, sample rate 24000Hz, 16-bit mono) and binary payload embedding. |
| `apps/readest-app/src/__tests__/services/tts/GeminiSpeechProvider.test.ts` | Mock `fetch` to verify `camelCase` REST payload (`responseModalities`, `speechConfig`, `voiceConfig`, `prebuiltVoiceConfig`, `voiceName`), HTTP 200 response decoding, HTTP 400/401/403/404 throwing `SpeechSynthesisPermanentError`, HTTP 429 `Retry-After` backoff parsing, and HTTP 5xx retries. |
| `apps/readest-app/src/__tests__/services/constants.test.ts` | Assert default TTS config contains `geminiApiKey: ''` and `geminiVoice: 'Puck'`, and `GEMINI_PREBUILT_VOICES` list contains expected voices (`Puck`, `Charon`, `Kore`, `Fenrir`, `Aoede`). |
| `apps/readest-app/src/__tests__/services/backup-settings.test.ts` | Test that `geminiApiKey` is sanitized when exporting backups without credentials and preserved when `includeCredentials: true`. |

---

## 3. Test Specifications & Code Examples

### 3.1 Audio Utility Unit Tests (`tts-pcm.test.ts`)

```typescript
import { describe, expect, test } from 'vitest';
import { createWavFromPcm, padBase64 } from '@/services/tts/pcm';

describe('padBase64', () => {
  test('adds correct padding to unpadded base64 strings', () => {
    expect(padBase64('abc')).toBe('abc=');
    expect(padBase64('ab')).toBe('ab==');
    expect(padBase64('abcd')).toBe('abcd');
  });
});

describe('createWavFromPcm', () => {
  test('creates a valid 44-byte RIFF/WAVE header prepended to PCM bytes', () => {
    const pcm = new Uint8Array([0x01, 0x02, 0x03, 0x04]);
    const wavBuffer = createWavFromPcm(pcm, 24000, 1, 16);
    const view = new DataView(wavBuffer);
    const bytes = new Uint8Array(wavBuffer);

    expect(wavBuffer.byteLength).toBe(44 + 4);

    // RIFF identifier "RIFF"
    expect(String.fromCharCode(...bytes.subarray(0, 4))).toBe('RIFF');
    // WAVE identifier "WAVE"
    expect(String.fromCharCode(...bytes.subarray(8, 12))).toBe('WAVE');
    // Subchunk1 ID "fmt "
    expect(String.fromCharCode(...bytes.subarray(12, 16))).toBe('fmt ');

    // Sample rate = 24000
    expect(view.getUint32(24, true)).toBe(24000);
    // Num channels = 1
    expect(view.getUint16(22, true)).toBe(1);
    // Bits per sample = 16
    expect(view.getUint16(34, true)).toBe(16);

    // Data identifier "data"
    expect(String.fromCharCode(...bytes.subarray(36, 40))).toBe('data');
    // Data length = 4
    expect(view.getUint32(40, true)).toBe(4);

    // Payload bytes match input
    expect(Array.from(bytes.subarray(44))).toEqual([0x01, 0x02, 0x03, 0x04]);
  });
});
```

### 3.2 Provider Unit Tests (`GeminiSpeechProvider.test.ts`)

```typescript
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { GeminiSpeechProvider } from '@/services/tts/providers/gemini';
import { SpeechSynthesisPermanentError } from '@/services/tts/providers/types';

describe('GeminiSpeechProvider', () => {
  let provider: GeminiSpeechProvider;

  beforeEach(() => {
    vi.restoreAllMocks();
    provider = new GeminiSpeechProvider();
    provider.setApiKey('test-api-key');
  });

  test('formats REST payload using camelCase schema', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    inlineData: {
                      mimeType: 'audio/pcm;rate=24000',
                      data: 'AAAA',
                    },
                  },
                ],
              },
            },
          ],
        }),
        { status: 200 }
      )
    );

    await provider.synthesize(
      { lang: 'en', text: 'Hello Gemini', voice: 'Puck', pitch: 1.0 },
      new AbortController().signal
    );

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('v1beta/models/gemini-2.5-flash:generateContent?key=test-api-key'),
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const callBody = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string);
    expect(callBody).toEqual({
      contents: [{ parts: [{ text: 'Hello Gemini' }] }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: 'Puck',
            },
          },
        },
      },
    });
  });

  test('throws SpeechSynthesisPermanentError on HTTP 400/401/403', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'API key not valid' } }), { status: 400 })
    );

    await expect(
      provider.synthesize(
        { lang: 'en', text: 'Test', voice: 'Puck', pitch: 1.0 },
        new AbortController().signal
      )
    ).rejects.toBeInstanceOf(SpeechSynthesisPermanentError);
  });
});
```

---

## 4. Acceptance Criteria

- [ ] `tts-pcm.test.ts` passes and validates Base64 padding normalization and RIFF/WAVE header binary generation.
- [ ] `GeminiSpeechProvider.test.ts` verifies strict camelCase REST request payloads and error classifications.
- [ ] `constants.test.ts` verifies default settings configuration for Gemini Voice.
- [ ] `backup-settings.test.ts` verifies `geminiApiKey` credential sanitization in backups.
