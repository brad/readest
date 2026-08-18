# Phase 5 Specification & Implementation Plan: Integration, Verification & Testing

**Target Plan File**: `plans/gemini-voice/phase5.md`  
**Parent Plan**: `plans/gemini-voice/overview.md`  
**Status**: Draft / Ready for Implementation

---

## 1. Overview & Objectives

Phase 5 focuses on comprehensive testing, verification, end-to-end integration, code quality, and repo compliance for the entire **Gemini Voice** feature.

By the end of Phase 5:
1. **Audio & Utility Testing**: Unit tests will verify Base64 padding normalization (`padBase64`) and 44-byte RIFF/WAVE header binary generation (`createWavFromPcm`) in `apps/readest-app/src/__tests__/utils/audio.test.ts`.
2. **Provider & Schema Testing**: Unit tests will verify `GeminiSpeechProvider` REST request formatting (camelCase compliance), response parsing, error classification (`SpeechSynthesisPermanentError`), and rate-limit backoff behavior in `apps/readest-app/src/__tests__/services/tts/GeminiSpeechProvider.test.ts`.
3. **Client & Integration Testing**: Integration tests will verify `GeminiTTSClient` lifecycle, preloading queue execution, cache hit/miss behavior with `CachingProvider` / `BookTTSCacheStore`, and `TTSController` event loop termination in `apps/readest-app/src/__tests__/services/tts/GeminiTTSClient.test.ts`.
4. **UI & Settings Testing**: Unit tests will verify `TTSPanel.tsx` rendering, API key masking, voice dropdown selection, API key validation triggering, and backup credential sanitization in `TTSPanel.test.tsx` and `backup-settings.test.ts`.
5. **Quality & Verification Standards**: The entire codebase will pass strict TypeScript type checking (`NODE_OPTIONS="--max-old-space-size=4096" pnpm exec tsc --noEmit`), Biome linting/formatting (`pnpm exec biome check --write`), and all Vitest unit/integration test suites (`pnpm test`).

---

## 2. Target Test Files & Coverage Strategy

| Test File Path | Description & Test Scenarios |
| --- | --- |
| `apps/readest-app/src/__tests__/utils/audio.test.ts` | Test `padBase64` with unpadded, 1-char, 2-char missing padding. Test `createWavFromPcm` byte header offsets (RIFF, WAVE, fmt, data) and payload embedding. |
| `apps/readest-app/src/__tests__/services/tts/GeminiSpeechProvider.test.ts` | Mock `fetch` to verify camelCase JSON schema, `HTTP 200` parsing, `HTTP 401/403` permanent errors, `HTTP 429` `Retry-After` parsing, and `HTTP 5xx` transient retries. |
| `apps/readest-app/src/__tests__/services/tts/GeminiTTSClient.test.ts` | Integration tests for `GeminiTTSClient` init, `getAllVoices()`, `speak()` iterator, preloading, cache hits via `CachingProvider`, and `MAX_CONSECUTIVE_SKIPS` error code yielding. |
| `apps/readest-app/src/__tests__/components/settings/TTSPanel.test.tsx` | Test Gemini section rendering in `TTSPanel`, entering API Key, selecting voice, clicking "Test" validation button, and feedback state updates. |
| `apps/readest-app/src/__tests__/services/backup-settings.test.ts` | Test that `geminiApiKey` is sanitized when exporting backups without credentials and preserved when credentials are included. |
| `apps/readest-app/src/__tests__/services/constants.test.ts` | Assert default TTS config includes `geminiApiKey: ''` and `geminiVoice: 'Puck'`, and `GEMINI_PREBUILT_VOICES` array contains valid prebuilt voices. |

---

## 3. Test Specifications & Code Examples

### 3.1 Audio Utility Unit Tests (`audio.test.ts`)

```typescript
import { describe, expect, test } from 'vitest';
import { createWavFromPcm, padBase64 } from '@/utils/audio';

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
      expect.stringContaining('v1beta/models/gemini-2.0-flash:generateContent?key=test-api-key'),
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

  test('throws SpeechSynthesisPermanentError on HTTP 401/403', async () => {
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

### 3.3 Integration & End-to-End Test Plan

1. **`GeminiTTSClient` Lifecycle & Preloading**:
   - Verify `GeminiTTSClient.init()` populates `this.voices` with standard prebuilt Gemini voices (`Puck`, `Charon`, `Kore`, `Fenrir`, `Aoede`).
   - Test preloading when `BufferedTTSClient` schedules multiple marks.
2. **`BookTTSCacheStore` Cache Hits**:
   - Synthesize a sentence once, confirm network `fetch` is called.
   - Synthesize the exact same sentence again with `CachingProvider` enabled, confirm `fetch` is NOT called and audio returns from `BookTTSCacheStore`.
3. **Backup Security**:
   - Export backup via `backupService.exportBackup(appService, { includeCredentials: false })`.
   - Assert `exportedSettings.globalViewSettings.geminiApiKey` is undefined or omitted.
   - Export backup with `{ includeCredentials: true }`, assert `geminiApiKey` is present.

---

## 4. Repository Verification & Pre-Commit Commands

Before submitting the implementation, all changes must pass the following repository verification suite:

```bash
# 1. Format and Linting Check (Biome)
pnpm exec biome check --write

# 2. Strict TypeScript Compilation Check (Increased Heap Memory)
NODE_OPTIONS="--max-old-space-size=4096" pnpm exec tsc --noEmit

# 3. Unit & Integration Test Suite Execution
pnpm test
```

---

## 5. Step-by-Step Implementation Sequence

1. **Step 1: Write Unit Tests for Audio Utilities**
   - Create `apps/readest-app/src/__tests__/utils/audio.test.ts`.
   - Test `padBase64` and `createWavFromPcm`.
2. **Step 2: Write Unit Tests for `GeminiSpeechProvider`**
   - Create `apps/readest-app/src/__tests__/services/tts/GeminiSpeechProvider.test.ts`.
   - Test REST payload serialization, camelCase compliance, HTTP status error handling, and `Retry-After` parsing.
3. **Step 3: Write Integration Tests for `GeminiTTSClient` & Backup Service**
   - Update `apps/readest-app/src/__tests__/services/backup-settings.test.ts` to assert `geminiApiKey` sanitization.
   - Update `apps/readest-app/src/__tests__/services/constants.test.ts` to assert default Gemini configs.
   - Create `apps/readest-app/src/__tests__/services/tts/GeminiTTSClient.test.ts`.
4. **Step 4: Execute Repository Verification Commands**
   - Run `pnpm exec biome check --write`.
   - Run `NODE_OPTIONS="--max-old-space-size=4096" pnpm exec tsc --noEmit`.
   - Run `pnpm test`.
5. **Step 5: Pre-Commit Checks & Final Review**
   - Complete pre-commit checks and verify all acceptance criteria are met across all 5 phases.

---

## 6. Final Acceptance Criteria

- [ ] **Unit Test Coverage**: Audio conversion utilities, base64 padding, and provider request serialization have 100% test coverage.
- [ ] **Integration Integrity**: `GeminiTTSClient`, `CachingProvider`, `TTSController`, and backup sanitization pass integration tests without regressions.
- [ ] **Type & Lint Cleanliness**: `tsc --noEmit` and `biome check` pass with zero errors across the monorepo.
- [ ] **End-to-End Verification**: Gemini Voice integrates seamlessly into Readest TTS controls, settings, and audio playout pipeline.
