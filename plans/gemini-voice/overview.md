# Gemini Voice Integration - Master Implementation Plan

This master plan outlines the step-by-step roadmap for implementing **Gemini Voice** in Readest. It provides high-level guidance, technical requirements, and phase breakdowns. Detailed implementation tasks for each phase are expanded into individual execution plan files (`phase1.md`, `phase2.md`, etc.).

---

## Architecture & Workflow Overview

```
┌─────────────────────────────────────────────────────────┐
│                    User Interface                       │
│  - Settings: API Key Entry, Voice & Pitch Selection     │
│  - TTS Controls: Play, Pause, Skip, Preload Indicator   │
└───────────────────────────┬─────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│                      TTSController                      │
│  - Manages playback state & sentence queue              │
│  - Receives yield status & dispatches highlight marks   │
└───────────────────────────┬─────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│                     GeminiTTSClient                     │
│  - Formats camelCase v1beta/generateContent API requests │
│  - Decodes PCM audio, pads Base64, prepends WAV header  │
│  - Handles retry backoff, caching, and preloading       │
└───────────────────────────┴─────────────────────────────┘
```

---

## Step-by-Step Implementation Roadmap

Below is the sequential breakdown of execution phases. Each phase represents a self-contained unit of work that can be planned and implemented independently.

---

### Phase 1: Settings, API Key Management & Configuration UI
*Target Plan File: `plans/gemini-voice/phase1.md`*

#### Objective
Enable users to configure Gemini Voice preferences, securely store their API key, select Gemini voices within Readest settings, and ensure API keys are stripped during backup export.

#### Key Deliverables
1. **Types & Default Configuration**:
   - Update `TTSConfig` interface in `apps/readest-app/src/types/book.ts` to include Gemini-specific fields (`geminiApiKey`, `geminiVoice`).
   - Define defaults in `DEFAULT_TTS_CONFIG` within `apps/readest-app/src/services/constants.ts`.
   - Add `ttsConfig.geminiApiKey` to `BACKUP_SETTINGS_CREDENTIAL_FIELDS` in `apps/readest-app/src/services/backupService.ts` to prevent unencrypted exports.
2. **Settings UI Component**:
   - Add Gemini Voice configuration UI under TTS / AI Settings.
   - Include API Key input field (masked/password input) and voice selection dropdown (e.g., Puck, Charon, Kore, Fenrir, Aoede).
3. **API Key Validation**:
   - Implement a lightweight validation test button or check using the Gemini REST endpoint (`v1beta/models`).

#### Acceptance Criteria
- API Key and voice selection persist across app reloads via `settingsService`.
- User receives immediate UI feedback when validating an API key.
- Unencrypted backups strip `geminiApiKey` unless credentials are explicitly included.

---

### Phase 2: Core `GeminiTTSClient` & Audio Processing Utilities
*Target Plan File: `plans/gemini-voice/phase2.md`*

#### Objective
Build the core `GeminiTTSClient` class conforming to the `TTSClient` interface and implement audio processing logic for raw PCM data returned by Gemini API.

#### Key Deliverables
1. **Audio Utility & PCM WAV Header Generator**:
   - Maintain/refine raw PCM (24kHz, mono, 16-bit) to RIFF/WAVE header conversion in `apps/readest-app/src/services/tts/pcm.ts`.
   - Ensure Base64 string decoding handles proper padding (`=`) before calling `atob()` to prevent browser decoding errors.
2. **`GeminiTTSClient` Request Schema**:
   - Implement client in `apps/readest-app/src/services/tts/GeminiTTSClient.ts`.
   - Ensure all request payload fields use `camelCase` required by Gemini `v1beta/generateContent` API (e.g., `responseModalities`, `speechConfig`, `voiceConfig`, `prebuiltVoiceConfig`, `voiceName`).
3. **Playback & Abort Handling**:
   - Manage `HTMLAudioElement` / `Audio` playback.
   - Catch `AbortError` and playback promises safely during pause, skip, or stop operations to prevent UI freezing.

#### Acceptance Criteria
- Text converted to audio plays smoothly in browser HTML5 audio element.
- Rapid skipping or stopping playback catches `AbortError` and resets state without crashing.

---

### Phase 3: Resilience, Error Handling & Rate Limiting
*Target Plan File: `plans/gemini-voice/phase3.md`*

#### Objective
Provide robust network error handling, handle Gemini API HTTP 429 rate limits, and maintain state synchronization with `TTSController`.

#### Key Deliverables
1. **Exponential Backoff & Rate Limit Handling**:
   - Implement exponential backoff with jitter for HTTP 429 (Too Many Requests) and 5xx server errors.
   - Parse `Retry-After` response headers when available.
2. **Controller Loop Termination**:
   - Yield explicit `error` event codes from `GeminiTTSClient.speak()` iterator to `TTSController`.
   - Ensure `TTSController` breaks playback loop on `error` code to reset state and clear "playing" UI.
3. **Graceful Fallback**:
   - Add optional automatic fallback to standard local/Edge TTS upon persistent API failures.

#### Acceptance Criteria
- HTTP 429 responses retry automatically according to backoff strategy.
- Unrecoverable errors terminate reading loop immediately and reset UI state cleanly.

---

### Phase 4A: Preloading & Sentence Synchronization
*Target Plan File: `plans/gemini-voice/phase4a.md`*

#### Objective
Ensure uninterrupted playback through background sentence preloading and accurate reading highlight synchronization (`speakMark`).

#### Key Deliverables
1. **Background Audio Preloading**:
   - Pre-fetch and synthesize upcoming sentences/paragraphs while current chunk plays using `BufferedTTSClient`'s scheduler.
2. **Highlight Synchronization (`speakMark`)**:
   - Call `this.controller.dispatchSpeakMark(mark)` as audio segments become audible (`chunk-start`) to synchronize reading position highlights in the book view.

#### Acceptance Criteria
- Transition between sentences is smooth with minimal buffering pause.
- Text highlights follow audio playback accurately.

---

### Phase 4B: Audio Caching & Section Compaction
*Target Plan File: `plans/gemini-voice/phase4b.md`*

#### Objective
Provide persistent local audio caching, offline pre-downloading, and section pack compaction for Gemini Voice synthesized audio.

#### Key Deliverables
1. **Audio Caching Layer**:
   - Store synthesized WAVE audio buffers in local store (`BookTTSCacheStore` / SQLite) via `CachingProvider`, indexed deterministically by prompt text, language, voice, and pitch.
   - Skip network fetch if synthesized audio already exists in cache.
2. **Offline Pre-downloading & Section Pack Compaction**:
   - Support headless chapter downloading (`warmSentence`) and section compaction (`compact`).

#### Acceptance Criteria
- Previously read content plays instantly from cache without firing Gemini API requests.
- Headless chapter downloading populates local cache for offline reading.

---

### Phase 5A: Unit & Provider Testing
*Target Plan File: `plans/gemini-voice/phase5a.md`*

#### Objective
Test low-level PCM audio conversion utilities, Gemini REST request schema serialization, error code classifications, rate limit backoff logic, default constants, and backup sanitization.

#### Key Deliverables
1. **Audio PCM Utility Tests**: Verify `padBase64` padding normalization and `createWavFromPcm` RIFF/WAVE header generation in `tts-pcm.test.ts`.
2. **Provider Tests**: Verify `GeminiSpeechProvider` camelCase REST payload serialization, HTTP 200/400/401/403/429/5xx parsing, and `Retry-After` backoff handling in `GeminiSpeechProvider.test.ts`.
3. **Configuration & Security Tests**: Verify `DEFAULT_TTS_CONFIG` defaults and `geminiApiKey` credential sanitization in `constants.test.ts` and `backup-settings.test.ts`.

#### Acceptance Criteria
- Unit tests for PCM utilities, Gemini provider serialization, constants, and backup sanitization pass cleanly.

---

### Phase 5B: Integration, UI & Verification Testing
*Target Plan File: `plans/gemini-voice/phase5b.md`*

#### Objective
Test `GeminiTTSClient` lifecycle, preloading queue execution, cache integration, UI settings panel controls, and verify repository quality across the monorepo.

#### Key Deliverables
1. **Integration Tests**: Verify `GeminiTTSClient` initialization, voice listing, preloading queue execution, cache hit/miss behavior, and `code: 'error'` loop termination in `GeminiTTSClient.test.ts`.
2. **UI & Settings Tests**: Verify `TTSPanel.tsx` rendering, API key entry masking, voice dropdown selection, and key validation triggering in `TTSPanel.test.tsx`.
3. **Repository Verification**: Execute Biome formatting (`pnpm exec biome check --write`), strict TypeScript checking (`NODE_OPTIONS="--max-old-space-size=4096" pnpm exec tsc --noEmit`), and full test suite execution (`pnpm test`).

#### Acceptance Criteria
- Integration and UI test suites pass cleanly.
- `tsc --noEmit` and `biome check` pass with zero errors across the monorepo.
