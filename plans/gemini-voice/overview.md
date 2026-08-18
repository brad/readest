# Gemini Voice Feature Overview

This document provides a high-level overview of the architecture, design, and implementation steps required to integrate **Gemini Voice** into Readest.

---

## 1. Objective & Scope

Readest currently supports reading ebooks aloud using standard/lower-quality TTS engines (such as Web Speech API, Native TTS, or Edge TTS). The **Gemini Voice** feature enhances the reading experience by bringing natural, high-fidelity AI-generated speech powered by Google's Gemini API.

At a high level:
- Users can provide their own **Gemini API Key** in settings.
- When enabled, Readest uses Gemini API speech generation to read book text aloud instead of standard voices.
- Advanced handling is introduced for audio formatting, rate limits, network resilience, quota management, and preloading.

---

## 2. High-Level Architecture & Workflow

```
┌─────────────────────────────────────────────────────────┐
│                    User Interface                       │
│  - Settings: API Key, Voice Selection                   │
│  - TTS Controls: Play, Pause, Skip                      │
└───────────────────────────┬─────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│                      TTSController                      │
│  - Manages playback state & queue                       │
│  - Dispatches highlight / sentence marks                │
└───────────────────────────┬─────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│                     GeminiTTSClient                     │
│  - Interacts with Gemini REST API                       │
│  - Decodes PCM audio & attaches RIFF/WAVE header        │
│  - Handles caching, retries, and rate limiting          │
└─────────────────────────────────────────────────────────┘
```

---

## 3. Key Technical Challenges & Complications

While replacing audio playback with Gemini API voices sounds straightforward, production integration presents several technical constraints and complications:

### A. API Key & Settings Configuration
- **User Provided Key**: Users specify their Gemini API key in Readest's TTS / AI Settings.
- **Secure Persistence**: Keys must be stored securely using system settings persistence (`settingsService` / `aiSettings`).
- **Validation**: On key input or test button click, perform a lightweight check to confirm API key validity.

### B. Request Formatting & Parameter Compliance
- **API Version & Endpoints**: Utilizes Gemini REST endpoints (`v1beta/generateContent`).
- **CamelCase Requirement**: Request payloads must strictly use `camelCase` for configuration fields (e.g., `responseModalities`, `speechConfig`, `voiceConfig`, `prebuiltVoiceConfig`, `voiceName`).
- **Modality**: Requesting audio output (`AUDIO` modality) returns raw PCM audio data.

### C. Audio Processing & Playback
- **Audio Format**: Gemini returns raw PCM audio data (typically 24kHz, 16-bit, mono PCM) encoded in Base64 within the response.
- **Base64 Decoding**: Base64 strings returned across network boundaries must ensure proper padding (`=`) to prevent browser `atob()` decoding errors.
- **WAVE Container Header**: Raw PCM cannot be directly played by HTML5 `HTMLAudioElement`. A valid RIFF/WAVE header must be generated and prepended to the PCM buffer before feeding to `HTMLAudioElement` or Web Audio API.
- **Playback Error Handling**: `HTMLAudioElement.play()` failures and `AbortError` (e.g. when user skips rapidly or stops playback) must be safely caught to prevent UI freeze in a stuck "playing" state.

### D. Network Hiccups & Resiliency
- **Retries & Timeouts**: Transient network drops require exponential backoff retries with reasonable timeouts.
- **Offline Fallback**: Option to fallback gracefully to standard local/Edge TTS when disconnected or network fails repeatedly.

### E. HTTP 429 & Rate Limiting
- **Throttling**: Gemini API imposes rate limits on request frequency.
- **Backoff Strategy**: On HTTP 429 response, parsing `Retry-After` headers and implementing exponential jitter backoff.
- **Controller Loop Termination**: `TTSController` must monitor error status codes yielded by the client. Yielding explicit `error` codes must break the playback loop to reset controller state cleanly.

### F. Quota Management
- **Token/Character Tracking**: Track estimated daily and monthly character usage against Gemini API free/paid tier limits.
- **Graceful Exhaustion**: Notify user when quota limits are reached and prompt user to inspect usage or switch voices.

### G. Preloading & Sentence Synchronization
- **Sentence Preloading**: Pre-fetch audio for upcoming paragraphs/sentences in the background to avoid buffering pauses between sentences.
- **Highlight Marks**: Dispatch `speakMark` events via `TTSController` to keep reading highlight synchronized with current paragraph/sentence playback.
- **Caching Layer**: Cache generated audio chunks (e.g. using `bookCacheStore` or IndexedDB/SQLite cache) to eliminate redundant API calls for previously read chapters.

---

## 4. Implementation Steps Overview

1. **Settings & Configuration UI**:
   - Add Gemini Voice option to `TTSConfig` / Settings UI.
   - Add input field for Gemini API Key and voice selector (e.g., Puck, Charon, Kore, Fenrir, Aoede).

2. **Gemini TTS Client Implementation (`GeminiTTSClient`)**:
   - Implement client conforming to `TTSClient` interface.
   - Construct API request with correct `camelCase` schema.
   - Handle Base64 decoding, PCM header attachment, and `HTMLAudioElement` / `WebAudioPlayer` setup.

3. **Resilience, Retry & Rate Limit Middleware**:
   - Wrap fetch requests in exponential backoff handler for 429/5xx errors.
   - Emit standard error events back to `TTSController` to maintain UI state consistency.

4. **Audio Caching & Preloading**:
   - Integrate with TTS caching stores to save decoded WAVE audio buffers.
   - Trigger preloading for next text block during current audio chunk playback.

5. **Testing & Verification**:
   - Unit tests for PCM WAV header generator and Base64 decoding.
   - Integration tests for settings persistence and client fallback behavior.

---

## 5. Future Documentation

Subsequent documents in this directory will break down each phase into step-by-step implementation specifications.
