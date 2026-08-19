# Phase 4A Specification & Implementation Plan: Preloading & Sentence Synchronization

**Target Plan File**: `plans/gemini-voice/phase4a.md`
**Parent Plan**: `plans/gemini-voice/overview.md`
**Status**: Completed

---

## 1. Overview & Objectives

Phase 4A focuses on optimizing the playback and highlight experience for **Gemini Voice** through background sentence preloading and sentence/paragraph highlight synchronization with the book view.

By the end of Phase 4A:
1. `GeminiTTSClient` leverages `BufferedTTSClient`'s scheduler to pre-fetch and synthesize upcoming sentences while current audio chunks play, eliminating buffering delays between sentences.
2. `GeminiTTSClient` triggers `this.controller.dispatchSpeakMark(mark)` precisely when audio chunks become audible (`chunk-start`), ensuring reading highlights in the book view remain synchronized with spoken voice playback.
3. Rapid section navigation or sentence skips cleanly cancel pending preloading queues without freezing or throwing uncaught errors.

---

## 2. Target Files & Key Components

| File Path | Description / Changes |
| --- | --- |
| `apps/readest-app/src/services/tts/GeminiTTSClient.ts` | Integrates with `BufferedTTSClient` preloading scheduler, mark dispatch routines, and overrides `getCapabilities()` returning `wordBoundaries: false`. |
| `apps/readest-app/src/services/tts/BufferedTTSClient.ts` | Inherits and leverages backpressure scheduler (`#runScheduler`), mark dispatch (`dispatchSpeakMark`), and preloading routines (`#preload`). |
| `apps/readest-app/src/services/tts/TTSController.ts` | Receives `dispatchSpeakMark(mark)` from client and updates reader DOM highlights (`foliate` mark cursor). |
| `apps/readest-app/src/__tests__/services/tts/GeminiTTSClient.test.ts` | Integration tests verifying preloading execution, mark dispatching, and abort handling for Gemini Voice. |

---

## 3. Background Audio Preloading Architecture

### 3.1 Dual Preloading Channels

1. **Explicit Mark Preloading (`#preload`)**:
   - When `speak(ssml, signal, preload = true)` is invoked (e.g., when moving to a new section/chapter), `BufferedTTSClient` immediately synthesizes the first 2 marks synchronously, then continues fetching remaining section marks in the background.
   - In-flight synthesis requests are deduplicated via the provider layer, preventing duplicate requests if playback begins while preloading is active.

2. **Sequential Backpressure Scheduling (`#runScheduler`)**:
   - During active playback, `#runScheduler` fetches, decodes, and schedules upcoming sentences ahead of the audio playhead under `WebAudioPlayer` / `NativeAudioPlayer` backpressure.
   - Synthesized WAV buffers are queued in advance so transitions between sentences happen gaplessly without network-induced pauses.

```
┌────────────────────────────────────────────────────────────────────────┐
│                        BufferedTTSClient Scheduler                     │
│                                                                        │
│  [Sentence N (Playing)] ──► Playout via AudioContext                   │
│  [Sentence N+1 (Ready)] ──► Decoded & Scheduled in Audio Buffer        │
│  [Sentence N+2 (Fetching)]─► Gemini API Request                       │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Sentence & Highlight Synchronization (`speakMark`)

### 4.1 Audible Mark Dispatching
In Readest's WebAudio architecture, marks are dispatched when audio becomes **audible** (`chunk-start` event triggered by audio player), rather than when the audio chunk is fetched or scheduled.

```typescript
// Inside BufferedTTSClient.speak loop:
for (;;) {
  const event = await queue.next();
  if (event.kind === 'chunk-start') {
    const meta = chunkMeta[event.index];
    if (!meta) continue;

    // Dispatch mark to controller when chunk begins audible playback
    const located = this.controller?.dispatchSpeakMark(meta.mark);

    // Word/Sentence level tracking
    this.#startWordTracking(generation, event.index, meta);
  }
  // ...
}
```

### 4.2 Handling Gemini Word Boundaries
Since Google Gemini API currently returns raw PCM audio without word-level timestamps (`boundaries = []`), `GeminiSpeechProvider` returns an empty `boundaries` array and `GeminiTTSClient.getCapabilities()` returns `wordBoundaries: false`.

- `GeminiTTSClient.getCapabilities()` returning `wordBoundaries: false` allows `TTSController.dispatchSpeakMark` to draw sentence highlights directly without suppression flash.
- `BufferedTTSClient.#startWordTracking` handles chunks with empty `boundaries` gracefully without throwing or stalling.

---

## 5. Step-by-Step Implementation Sequence

1. **Step 1: Preloading & Queue Synchronization**
   - Verified `GeminiTTSClient` inherits `#preload()` and `#runScheduler()` from `BufferedTTSClient`.
   - Overrode `getCapabilities()` in `GeminiTTSClient` to specify `wordBoundaries: false`.

2. **Step 2: Highlight Synchronization Verification**
   - Verified `dispatchSpeakMark(mark)` is called on `chunk-start` events for Gemini audio.
   - Ensured sentence highlights update smoothly in the reader view as each Gemini TTS audio chunk begins playing.

3. **Step 3: Unit & Integration Testing**
   - Added integration tests in `apps/readest-app/src/__tests__/services/tts/GeminiTTSClient.test.ts` testing:
     - `getCapabilities()` returning `wordBoundaries: false`.
     - Preloading execution (`speak(ssml, signal, preload = true)`).
     - Event emission for `dispatchSpeakMark` and `boundary` on `chunk-start`.
     - Abort signal handling during active preloading and playback.

---

## 6. Acceptance & Verification Criteria

- [x] **Smooth Preloading**: Transitions between sentences occur gaplessly without audio stuttering or loading delays.
- [x] **Highlight Accuracy**: Reader DOM highlights update precisely when sentence audio playback starts (`chunk-start`).
- [x] **Clean Abort**: Skipping sentences or pausing cancels background preloading queues cleanly.
