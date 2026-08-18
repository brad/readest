# Phase 4 Specification & Implementation Plan: Preloading, Sentence Synchronization & Audio Caching

**Target Plan File**: `plans/gemini-voice/phase4.md`  
**Parent Plan**: `plans/gemini-voice/overview.md`  
**Status**: Draft / Ready for Implementation

---

## 1. Overview & Objectives

Phase 4 focuses on optimizing the playback experience for **Gemini Voice** through background sentence preloading, sentence/paragraph highlight synchronization with the book view, and per-book persistent audio caching.

By the end of Phase 4:
1. `GeminiTTSClient` will leverage `BufferedTTSClient`'s scheduler to pre-fetch and synthesize upcoming sentences while current audio chunks play, eliminating buffering delays between sentences.
2. `GeminiTTSClient` will trigger `this.controller.dispatchSpeakMark(mark)` precisely when audio chunks become audible (`chunk-start`), ensuring reading highlights in the book view remain synchronized with spoken voice playback.
3. Audio responses synthesized by `GeminiSpeechProvider` will be wrapped by `CachingProvider` and saved to `BookTTSCacheStore` (SQLite/OPFS/plugin-fs), keyed deterministically by prompt text, language, voice, and pitch.
4. Download and cache-warming routines (`warmSentence()`, `compact()`) will enable offline playback and section pack compaction for Gemini Voice.

---

## 2. Target Files & Key Components

| File Path | Description / Changes |
| --- | --- |
| `apps/readest-app/src/services/tts/GeminiTTSClient.ts` | Ensure `GeminiTTSClient` passes `appService` to `BufferedTTSClient` and instantiates `CachingProvider` with `BookTTSCacheStore`. |
| `apps/readest-app/src/services/tts/BufferedTTSClient.ts` | Inherit and leverage backpressure scheduler (`#runScheduler`), mark dispatch (`dispatchSpeakMark`), word tracking, and preloading routines. |
| `apps/readest-app/src/services/tts/providers/cache.ts` | `CachingProvider` wraps `GeminiSpeechProvider` to check/store audio buffers using `computeTTSCacheKey`. |
| `apps/readest-app/src/services/tts/providers/bookCacheStore.ts` | `BookTTSCacheStore` handles SQLite database persistence and section pack creation. |
| `apps/readest-app/src/services/tts/TTSController.ts` | Receives `dispatchSpeakMark(mark)` from client and updates reader DOM highlights (`foliate` mark cursor). |
| `apps/readest-app/src/__tests__/services/tts/GeminiTTSClient.test.ts` | Integration tests verifying preloading, mark dispatching, and cache hit/miss behavior for Gemini Voice. |

---

## 3. Background Audio Preloading Architecture

### 3.1 Dual Preloading Channels

1. **Explicit Mark Preloading (`#preload`)**:
   - When `speak(ssml, signal, preload = true)` is invoked (e.g., when moving to a new section/chapter), `BufferedTTSClient` immediately synthesizes the first 2 marks synchronously, then continues fetching remaining section marks in the background.
   - `CachingProvider` deduplicates in-flight synthesis requests via `#inflight` map, preventing duplicate requests if playback begins while preloading is active.

2. **Sequential Backpressure Scheduling (`#runScheduler`)**:
   - During active playback, `#runScheduler` fetches, decodes, and schedules upcoming sentences ahead of the audio playhead under `WebAudioPlayer` / `NativeAudioPlayer` backpressure.
   - Synthesized WAV buffers are queued in advance so transitions between sentences happen gaplessly without network-induced pauses.

```
┌────────────────────────────────────────────────────────────────────────┐
│                        BufferedTTSClient Scheduler                     │
│                                                                        │
│  [Sentence N (Playing)] ──► Playout via AudioContext                   │
│  [Sentence N+1 (Ready)] ──► Decoded & Scheduled in Audio Buffer        │
│  [Sentence N+2 (Fetching)]─► Gemini API Request / CachingProvider Hit  │
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

    if (located && meta.req && this.provider instanceof CachingProvider) {
      // Record mark key for section manifest compaction
      this.provider.recordMark(located.sectionIndex, located.sentenceIndex, meta.req);
    }

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

## 5. Audio Caching Layer (`CachingProvider` & `BookTTSCacheStore`)

### 5.1 Cache Key Determinism
`CachingProvider` computes an MD5 cache key using `computeTTSCacheKey`:

$$\text{Key} = \text{MD5}(\text{JSON.stringify}([\text{"tts-v1"}, \text{"gemini-tts"}, \text{lang}, \text{voice}, \text{pitch}, \text{text}]))$$

Note that playback **rate** is excluded from the cache key because Gemini audio is synthesized at rate 1.0 and time-stretched at playout time (via WSOLA in WebAudio or rate scaling in Native AVPlayer). This allows a single cached audio file to be replayed at any reading speed.

### 5.2 Store Integration & Offline Pre-downloading
When `appService` is provided to `GeminiTTSClient`, `GeminiTTSClient` decorates `GeminiSpeechProvider` with `CachingProvider` backed by `BookTTSCacheStore`:

1. **Cache Reads (`store.get(key)`)**:
   - Before firing a REST request to `v1beta/generateContent`, `CachingProvider` queries the per-book SQLite database (`Cache/tts-cache/<book_hash>/cache.db`).
   - If a hit occurs, the cached ArrayBuffer is returned instantly without hitting network or API rate limits.
2. **Cache Writes (`store.put(key, entry)`)**:
   - Newly synthesized WAV buffers and boundary metadata are saved to the database.
3. **Headless Cache Warming (`warmSentence`)**:
   - `GeminiTTSClient.warmSentence(section, ordinal, lang, text)` synthesizes sentences into cache during background chapter downloads.
4. **Section Pack Compaction (`compact`)**:
   - Once all sentences in a section are cached, `compact()` merges individual sentence rows into a single MP3/WAV section pack file (`packs/section_<N>.pack`) to optimize disk space and I/O.

---

## 6. Step-by-Step Implementation Sequence

1. **Step 1: Verify `GeminiTTSClient` Caching Integration**
   - Confirm `GeminiTTSClient` constructor initializes `CachingProvider` with `BookTTSCacheStore` when `appService` and cache config are active.
   - Verify `registerSectionManifest`, `getSectionDurations`, `canDownload`, `warmSentence`, and `compactCache` delegate properly to `CachingProvider`.

2. **Step 2: Preloading & Queue Synchronization**
   - Verify `GeminiTTSClient` inherits `#preload()` and `#runScheduler()` from `BufferedTTSClient`.
   - Ensure in-flight requests share promises through `CachingProvider.#inflight` during simultaneous preloading and playback.

3. **Step 3: Highlight Synchronization Verification**
   - Verify that `dispatchSpeakMark(mark)` is called on `chunk-start` events for Gemini audio.
   - Ensure sentence highlights update smoothly in the reader view as each Gemini TTS audio chunk begins playing.

4. **Step 4: Unit & Integration Testing**
   - Write integration tests in `apps/readest-app/src/__tests__/services/tts/GeminiTTSClient.test.ts` testing:
     - Preloading queue execution.
     - Cache hit vs miss behavior with `CachingProvider`.
     - `warmSentence()` and section compaction with `BookTTSCacheStore`.
     - Event emission for `dispatchSpeakMark`.

5. **Step 5: Code Quality & Verification**
   - Run `pnpm exec biome check --write`.
   - Run `NODE_OPTIONS="--max-old-space-size=4096" pnpm exec tsc --noEmit`.
   - Run `pnpm test`.

---

## 7. Acceptance & Verification Criteria

- [ ] **Smooth Preloading**: Transitions between sentences occur gaplessly without audio stuttering or loading delays.
- [ ] **Highlight Accuracy**: Reader DOM highlights update precisely when sentence audio playback starts (`chunk-start`).
- [ ] **Instant Cache Hits**: Re-reading previously spoken content plays immediately from local cache without triggering network requests to Gemini API.
- [ ] **Offline Pre-downloading**: Headless chapter downloading (`warmSentence`) populates local cache for offline reading.
- [ ] **Compaction**: Fully cached sections produce compacted section packs.
- [ ] **Type & Lint Safety**: Passes `tsc --noEmit` and `biome check` cleanly.
