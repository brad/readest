# Phase 2 Specification & Implementation Plan: Core `GeminiTTSClient` & Audio Processing Utilities

**Target Plan File**: `plans/gemini-voice/phase2.md`
**Parent Plan**: `plans/gemini-voice/overview.md`
**Status**: Draft / Ready for Review

---

## 1. Overview & Objectives

Phase 2 builds the core audio processing utilities, REST payload schema serialization, and the primary TTS engine components (`GeminiSpeechProvider` and `GeminiTTSClient`) for **Gemini Voice** in Readest.

By the end of Phase 2:
1. Raw PCM audio data (24kHz, mono, 16-bit little-endian) returned by Google Gemini API will be formatted into playable RIFF/WAVE ArrayBuffers with normalized Base64 padding.
2. `GeminiSpeechProvider` will conform strictly to the `SpeechProvider` interface, formatting REST requests using Gemini's required camelCase schema.
3. `GeminiTTSClient` will extend `BufferedTTSClient` to seamlessly leverage Readest's WebAudio / Native audio playback pipeline, time-stretching (WSOLA), inter-sentence gap control, and per-book persistent audio caching (`BookTTSCacheStore`).
4. `TTSController` will initialize and register `GeminiTTSClient`, allowing users to select Gemini voices in the reading interface.

---

## 2. Target Files & Key Components

| File Path | Description / Changes |
| --- | --- |
| `apps/readest-app/src/services/tts/pcm.ts` | Utilities for Base64 string padding normalization and 44-byte RIFF/WAVE header generation for raw 24kHz 16-bit mono PCM data. |
| `apps/readest-app/src/services/tts/providers/gemini.ts` | Implement `GeminiSpeechProvider` conforming to `SpeechProvider` interface. |
| `apps/readest-app/src/services/tts/GeminiTTSClient.ts` | Implement `GeminiTTSClient` subclassing `BufferedTTSClient`. |
| `apps/readest-app/src/services/tts/TTSController.ts` | Instantiate `GeminiTTSClient`, include Gemini voices in `getVoices()`, and handle client selection in `setVoice()`. |
| `apps/readest-app/src/__tests__/utils/audio.test.ts` | Unit tests for Base64 padding normalization and RIFF/WAVE header binary correctness. |
| `apps/readest-app/src/__tests__/services/tts/GeminiSpeechProvider.test.ts` | Unit tests for REST API request payload formatting (camelCase compliance) and response parsing. |

---

## 3. Audio Processing & PCM-to-WAV Utilities

Google Gemini API (e.g. `gemini-2.0-flash`) returns raw audio in `AUDIO` modality as Base64-encoded raw PCM data (24,000 Hz sample rate, 1 channel / mono, 16-bit little-endian signed integer). To allow standard Web Audio decoders (`decodeAudioData`) or native audio players to play this data, it must be wrapped with a valid 44-byte RIFF/WAVE header.

### 3.1 Base64 Padding Normalization (`padBase64`)
When Base64 audio chunks are received from external REST APIs, missing trailing padding (`=`) causes browser `atob()` functions to throw `The string to be decoded is not correctly encoded`.

```typescript
export function padBase64(b64: string): string {
  const remainder = b64.length % 4;
  if (remainder === 0) return b64;
  return b64 + '='.repeat(4 - remainder);
}
```

### 3.2 PCM to RIFF/WAVE ArrayBuffer Conversion (`createWavFromPcm`)
A 44-byte RIFF header is constructed in little-endian format and prepended to the raw PCM `Uint8Array`:

```typescript
export function createWavFromPcm(
  pcmData: Uint8Array,
  sampleRate = 24000,
  numChannels = 1,
  bitsPerSample = 16
): ArrayBuffer {
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = pcmData.byteLength;
  const chunkSize = 36 + dataSize;

  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  // RIFF Chunk Descriptor
  view.setUint32(0, 0x52494646, false); // "RIFF" (Big-endian ASCII)
  view.setUint32(4, chunkSize, true);    // Little-endian
  view.setUint32(8, 0x57415645, false); // "WAVE" (Big-endian ASCII)

  // "fmt " Sub-chunk
  view.setUint32(12, 0x666d7420, false); // "fmt "
  view.setUint32(16, 16, true);          // Subchunk1Size (16 for PCM)
  view.setUint16(20, 1, true);           // AudioFormat (1 = PCM)
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);

  // "data" Sub-chunk
  view.setUint32(36, 0x64617461, false); // "data"
  view.setUint32(40, dataSize, true);

  // Copy raw PCM sample bytes
  const pcmBytes = new Uint8Array(buffer, 44, dataSize);
  pcmBytes.set(pcmData);

  return buffer;
}
```

---

## 4. Gemini REST API Schema Specification

The Gemini REST API `v1beta/generateContent` endpoint requires **strict camelCase** for all configuration fields. Snake_case fields (e.g. `response_modalities`) are silently ignored or rejected by Google servers.

### 4.1 Request Schema (`v1beta/generateContent`)
- **Endpoint**: `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`
- **HTTP Method**: `POST`
- **Headers**: `Content-Type: application/json`

```json
{
  "contents": [
    {
      "parts": [
        {
          "text": "The sentence or paragraph to synthesize into speech."
        }
      ]
    }
  ],
  "generationConfig": {
    "responseModalities": ["AUDIO"],
    "speechConfig": {
      "voiceConfig": {
        "prebuiltVoiceConfig": {
          "voiceName": "Puck"
        }
      }
    }
  }
}
```

### 4.2 Response Schema & Parsing
The REST response contains candidate parts with `inlineData` holding the base64-encoded audio:

```json
{
  "candidates": [
    {
      "content": {
        "parts": [
          {
            "inlineData": {
              "mimeType": "audio/pcm;rate=24000",
              "data": "U3BlZWNoIFBDTSBCeXRlcy4uLg=="
            }
          }
        ]
      }
    }
  ]
}
```

---

## 5. Gemini Speech Provider (`GeminiSpeechProvider`)

Implemented in `apps/readest-app/src/services/tts/providers/gemini.ts`:

```typescript
import { GEMINI_PREBUILT_VOICES, DEFAULT_GEMINI_VOICE } from '@/services/constants';
import { createWavFromPcm, padBase64 } from '@/services/tts/pcm';
import type { TTSVoice } from '../types';
import {
  SpeechProvider,
  SpeechSynthesisPermanentError,
  SpeechSynthesisRequest,
  SpeechSynthesisResult,
} from './types';

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
    return true; // Active when API key is provided
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

    const json = await response.json();
    const candidate = json.candidates?.[0];
    const part = candidate?.content?.parts?.find((p: any) => p.inlineData?.data);

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
      boundaries: [], // Gemini audio API does not emit word boundaries
    };
  }
}
```

---

## 6. Gemini TTS Client (`GeminiTTSClient`)

Implemented in `apps/readest-app/src/services/tts/GeminiTTSClient.ts`:

```typescript
import { AppService } from '@/types/system';
import { BufferedTTSClient } from './BufferedTTSClient';
import { GeminiSpeechProvider } from './providers/gemini';
import { BookTTSCacheStore, getTTSCacheConfig } from './providers/bookCacheStore';
import { CachingProvider } from './providers/cache';
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
}
```

---

## 7. `TTSController` Integration

In `apps/readest-app/src/services/tts/TTSController.ts`:

1. Instantiate `this.ttsGeminiClient = new GeminiTTSClient(this, appService)`.
2. Update `init()`:
   ```typescript
   if (await this.ttsGeminiClient.init()) {
     availableClients.push(this.ttsGeminiClient);
     this.ttsGeminiVoices = await this.ttsGeminiClient.getAllVoices();
   }
   ```
3. Update `getVoices(lang)`:
   ```typescript
   const ttsGeminiVoices = await this.ttsGeminiClient.getVoices(lang);
   ```
4. Update `setVoice(voiceId, lang)`:
   Check if `voiceId` belongs to `ttsGeminiVoices`. If so, route active client to `this.ttsGeminiClient`.

---

## 8. Step-by-Step Implementation Sequence

1. **Step 1: Audio Utilities**
   - Create `padBase64` and `createWavFromPcm` in `apps/readest-app/src/services/tts/pcm.ts`.
   - Write unit tests in `apps/readest-app/src/__tests__/utils/audio.test.ts`.
2. **Step 2: `GeminiSpeechProvider` Implementation**
   - Create `apps/readest-app/src/services/tts/providers/gemini.ts`.
   - Implement `synthesize()` with camelCase schema formatting and REST API call.
   - Write unit tests in `apps/readest-app/src/__tests__/services/tts/GeminiSpeechProvider.test.ts`.
3. **Step 3: `GeminiTTSClient` Implementation**
   - Create `apps/readest-app/src/services/tts/GeminiTTSClient.ts`.
   - Wrap `GeminiSpeechProvider` and configure `CachingProvider` support.
4. **Step 4: `TTSController` Integration**
   - Wire `ttsGeminiClient` into `TTSController` lifecycle (`init`, `getVoices`, `setVoice`).
5. **Step 5: Code Quality & Verification**
   - Execute `pnpm exec biome check --write`.
   - Run type checker `NODE_OPTIONS="--max-old-space-size=4096" pnpm exec tsc --noEmit`.

---

## 9. Acceptance & Verification Criteria

- [ ] **Base64 & WAV Conversion**: Unit tests pass verifying exact 44-byte RIFF header offsets, PCM data copying, and Base64 padding normalization.
- [ ] **REST Payload Compliance**: Unit tests verify JSON payload generated for `v1beta/generateContent` contains only camelCase keys (`responseModalities`, `speechConfig`, `voiceConfig`, `prebuiltVoiceConfig`, `voiceName`).
- [ ] **Audio Playback**: `GeminiTTSClient` successfully decodes synthesized WAV audio and schedules playback using Readest's `BufferedTTSClient`.
- [ ] **State Machine Integrity**: Stopping or skipping audio gracefully cancels in-flight fetch requests without throwing uncaught promise rejections.
- [ ] **Type & Lint Safety**: Passes `tsc --noEmit` and `biome check` cleanly.
