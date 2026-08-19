# Phase 4A Specification & Implementation Plan: Preloading & Sentence Synchronization

**Target Plan File**: `plans/gemini-voice/phase4a.md`
**Parent Plan**: `plans/gemini-voice/overview.md`
**Status**: Draft / Ready for Implementation

---

## 1. Overview & Objectives

Phase 4A focuses on optimizing the playback and highlight experience for **Gemini Voice** through background sentence preloading and sentence/paragraph highlight synchronization with the book view.

By the end of Phase 4A:
1. `GeminiTTSClient` will leverage `BufferedTTSClient`'s scheduler to pre-fetch and synthesize upcoming sentences while current audio chunks play, eliminating buffering delays between sentences.
2. `GeminiTTSClient` will trigger `this.controller.dispatchSpeakMark(mark)` precisely when audio chunks become audible (`chunk-start`), ensuring reading highlights in the book view remain synchronized with spoken voice playback.
3. Rapid section navigation or sentence skips will cleanly cancel pending preloading queues without freezing or throwing uncaught errors.

---

## 2. Target Files & Key Components

| File Path | Description / Changes |
| --- | --- |
| `apps/readest-app/src/services/tts/GeminiTTSClient.ts` | Ensure `GeminiTTSClient` properly integrates with `BufferedTTSClient` preloading scheduler and mark dispatch routines. |
| `apps/readest-app/src/services/tts/BufferedTTSClient.ts` | Inherit and leverage backpressure scheduler (`#runScheduler`), mark dispatch (`dispatchSpeakMark`), and preloading routines. |
| `apps/readest-app/src/services/tts/TTSController.ts` | Receives `dispatchSpeakMark(mark)` from client and updates reader DOM highlights (`foliate` mark cursor). |
| `apps/readest-app/src/__tests__/services/tts/GeminiTTSClient.test.ts` | Integration tests verifying preloading execution and mark dispatching for Gemini Voice. |

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
In Readest's WebAudio architecture, marks must be dispatched when audio becomes **audible** (`chunk-start` event triggered by audio player), rather than when the audio chunk is fetched or scheduled.

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
Since Google Gemini API currently returns raw PCM audio without word-level timestamps (`boundaries = []`), `GeminiSpeechProvider` returns an empty `boundaries` array.

- `BufferedTTSClient.#startWordTracking` checks if `boundaries` is empty.
- When `boundaries` is empty, `TTSController.prepareSpeakWords` draws the full sentence highlight in the book reader view, maintaining accurate sentence-level visual synchronization.

---

## 5. Step-by-Step Implementation Sequence

1. **Step 1: Preloading & Queue Synchronization**
   - Verify `GeminiTTSClient` inherits `#preload()` and `#runScheduler()` from `BufferedTTSClient`.
   - Ensure in-flight requests share promises during simultaneous preloading and playback.

2. **Step 2: Highlight Synchronization Verification**
   - Verify that `dispatchSpeakMark(mark)` is called on `chunk-start` events for Gemini audio.
   - Ensure sentence highlights update smoothly in the reader view as each Gemini TTS audio chunk begins playing.

3. **Step 3: Unit & Integration Testing**
   - Write integration tests in `apps/readest-app/src/__tests__/services/tts/GeminiTTSClient.test.ts` testing:
     - Preloading queue execution.
     - Event emission for `dispatchSpeakMark`.

---

## 6. Acceptance & Verification Criteria

- [ ] **Smooth Preloading**: Transitions between sentences occur gaplessly without audio stuttering or loading delays.
- [ ] **Highlight Accuracy**: Reader DOM highlights update precisely when sentence audio playback starts (`chunk-start`).
- [ ] **Clean Abort**: Skipping sentences or pausing cancels background preloading queues cleanly.
