# Phase 4B Specification & Implementation Plan: Audio Caching & Section Compaction

**Target Plan File**: `plans/gemini-voice/phase4b.md`
**Parent Plan**: `plans/gemini-voice/overview.md`
**Status**: Completed

---

## 1. Overview & Objectives

Phase 4B focuses on persistent audio caching, offline pre-downloading, and section pack compaction for **Gemini Voice** using `CachingProvider` and `BookTTSCacheStore`.

By the end of Phase 4B:
1. Audio responses synthesized by `GeminiSpeechProvider` will be wrapped by `CachingProvider` and saved to `BookTTSCacheStore` (SQLite/OPFS/plugin-fs), keyed deterministically by prompt text, language, voice, and pitch.
2. Previously synthesized content will play instantly from local cache without incurring network bandwidth or Gemini API calls.
3. Download and cache-warming routines (`warmSentence()`, `compact()`) will enable offline playback and section pack compaction for Gemini Voice.

---

## 2. Target Files & Key Components

| File Path | Description / Changes |
| --- | --- |
| `apps/readest-app/src/services/tts/GeminiTTSClient.ts` | Ensure `GeminiTTSClient` passes `appService` to `BufferedTTSClient` and instantiates `CachingProvider` with `BookTTSCacheStore`. |
| `apps/readest-app/src/services/tts/providers/cache.ts` | `CachingProvider` wraps `GeminiSpeechProvider` to check/store audio buffers using `computeTTSCacheKey`. |
| `apps/readest-app/src/services/tts/providers/bookCacheStore.ts` | `BookTTSCacheStore` handles SQLite database persistence and section pack creation. |
| `apps/readest-app/src/__tests__/services/tts/GeminiTTSClient.test.ts` | Integration tests verifying cache hit/miss behavior, `warmSentence()`, and compaction for Gemini Voice. |

---

## 3. Audio Caching Layer (`CachingProvider` & `BookTTSCacheStore`)

### 3.1 Cache Key Determinism
`CachingProvider` computes an MD5 cache key using `computeTTSCacheKey`:

$$\text{Key} = \text{MD5}(\text{JSON.stringify}([\text{"tts-v1"}, \text{"gemini-tts"}, \text{lang}, \text{model}, \text{voice}, \text{pitch}, \text{text}]))$$

Note that playback **rate** is excluded from the cache key because Gemini audio is synthesized at rate 1.0 and time-stretched at playout time (via WSOLA in WebAudio or rate scaling in Native AVPlayer). This allows a single cached audio file to be replayed at any reading speed.

### 3.2 Store Integration & Offline Pre-downloading
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

## 4. Step-by-Step Implementation Sequence

1. **Step 1: Verify `GeminiTTSClient` Caching Integration**
   - Confirm `GeminiTTSClient` constructor initializes `CachingProvider` with `BookTTSCacheStore` when `appService` and cache config are active.
   - Verify `registerSectionManifest`, `getSectionDurations`, `canDownload`, `warmSentence`, and `compactCache` delegate properly to `CachingProvider`.

2. **Step 2: Cache Hit/Miss Execution**
   - Ensure in-flight requests share promises through `CachingProvider.#inflight` during preloading and playback.

3. **Step 3: Unit & Integration Testing**
   - Write integration tests in `apps/readest-app/src/__tests__/services/tts/GeminiTTSClient.test.ts` testing:
     - Cache hit vs miss behavior with `CachingProvider`.
     - `warmSentence()` and section compaction with `BookTTSCacheStore`.

---

## 5. Acceptance & Verification Criteria

- [x] **Instant Cache Hits**: Re-reading previously spoken content plays immediately from local cache without triggering network requests to Gemini API.
- [x] **Offline Pre-downloading**: Headless chapter downloading (`warmSentence`) populates local cache for offline reading.
- [x] **Compaction**: Fully cached sections produce compacted section packs.
