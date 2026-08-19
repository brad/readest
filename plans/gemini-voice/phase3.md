# Phase 3 Specification & Implementation Plan: Resilience, Error Handling & Rate Limiting

**Target Plan File**: `plans/gemini-voice/phase3.md`  
**Parent Plan**: `plans/gemini-voice/overview.md`  
**Status**: Completed

---

## 1. Overview & Objectives

Phase 3 focuses on making the **Gemini Voice** integration in Readest highly resilient against network instability, API rate limits (HTTP 429), server failures (HTTP 5xx), and invalid client configurations (HTTP 4xx).

By the end of Phase 3:
1. `GeminiSpeechProvider` will classify HTTP status codes into permanent failures (`SpeechSynthesisPermanentError`) versus transient errors that warrant retries.
2. `GeminiSpeechProvider` will implement exponential backoff with full jitter and parse `Retry-After` headers (both integer seconds and HTTP-date formats).
3. `BufferedTTSClient` will handle retries (`#synthesizeWithRetry`), track consecutive sentence skips (`MAX_CONSECUTIVE_SKIPS`), and yield `code: 'error'` events to terminate playback loops safely when unrecoverable errors occur.
4. `TTSController` will catch `error` events yielded by `GeminiTTSClient`, trigger `#terminate('error')`, dispatch `tts-session-ended`, and reset the UI state to `'stopped'`, preventing the reader interface from hanging in a "playing" state.
5. The system will provide graceful fallback pathways, such as notifying the user of invalid API keys (`tts-need-auth`) or falling back to local/Edge TTS options.

---

## 2. Target Files & Key Components

| File Path | Description / Changes |
| --- | --- |
| `apps/readest-app/src/services/tts/providers/gemini.ts` | Implement error classification, `Retry-After` header parsing, exponential backoff with jitter, and transient/permanent error handling in `GeminiSpeechProvider`. |
| `apps/readest-app/src/services/tts/GeminiTTSClient.ts` | Inherit and leverage `BufferedTTSClient`'s retry and consecutive error handling (`MAX_CONSECUTIVE_SKIPS`). |
| `apps/readest-app/src/services/tts/TTSController.ts` | Ensure `TTSController` handles `error` events yielded by `speak()` iterators, resetting playback state and dispatching termination events. |
| `apps/readest-app/src/__tests__/services/tts/GeminiSpeechProvider.test.ts` | Unit tests for error classification, `Retry-After` header parsing, backoff delay calculations, and permanent vs transient error throwing. |
| `apps/readest-app/src/__tests__/services/tts/GeminiTTSClient.test.ts` | Integration tests verifying `GeminiTTSClient` behavior during rate limits, retry exhaustion, and consecutive skip termination. |

---

## 3. Error Classification Strategy

To prevent endless retry loops on invalid requests while remaining resilient to temporary network or server hiccups, errors returned by Google Gemini API (`v1beta/generateContent`) are classified into two strict categories:

### 3.1 Permanent Errors (`SpeechSynthesisPermanentError`)
Permanent errors indicate that retrying the exact same request with the same API key will never succeed. `GeminiSpeechProvider` throws `SpeechSynthesisPermanentError` immediately without retrying:

- **HTTP 400 Bad Request**: Malformed JSON, unsupported prompt format, or invalid voice parameter.
- **HTTP 401 Unauthorized / HTTP 403 Forbidden**: Invalid, expired, or unauthenticated Gemini API key.
- **HTTP 404 Not Found**: Model endpoint or resource does not exist (e.g. invalid model name).
- **Empty Audio Data Response**: API returns `HTTP 200` but candidate parts contain no `inlineData` audio payload.

When `SpeechSynthesisPermanentError` is thrown:
1. `GeminiSpeechProvider` halts request retries immediately.
2. `BufferedTTSClient` catches `SpeechSynthesisPermanentError` and skips the individual sentence without stopping the entire playback session (unless `MAX_CONSECUTIVE_SKIPS` is exceeded).
3. If the error is due to an invalid/missing API key (HTTP 401/403), `TTSController` emits `tts-need-auth` to prompt the user to update their settings.

### 3.2 Transient Errors (Retried with Backoff)
Transient errors represent temporary service disruptions or rate throttling that are expected to resolve after a short delay:

- **HTTP 429 Too Many Requests**: Rate limit or quota quota exceeded (RPM/TPM limit).
- **HTTP 500 Internal Server Error**: Gemini backend service internal error.
- **HTTP 502 Bad Gateway / HTTP 503 Service Unavailable / HTTP 504 Gateway Timeout**: Temporary API gateway or upstream availability issue.
- **Network / Fetch Errors**: Browser `TypeError` due to temporary network disconnection or DNS lookup failure.

---

## 4. Rate Limiting, `Retry-After` Parsing & Backoff Algorithm

### 4.1 `Retry-After` Header Parsing
When Gemini returns an `HTTP 429` or `HTTP 503` response, it may include a `Retry-After` header indicating how long to wait before sending another request. `GeminiSpeechProvider` parses both standard formats:

1. **Seconds (Integer)**: e.g. `Retry-After: 5` -> Wait 5000ms.
2. **HTTP-Date (RFC 7231)**: e.g. `Retry-After: Wed, 21 Oct 2025 07:28:00 GMT` -> Calculate `Date.parse(header) - Date.now()`.

```typescript
export function parseRetryAfterHeader(headerValue: string | null): number | null {
  if (!headerValue) return null;
  const trimmed = headerValue.trim();

  // Try parsing as integer seconds
  if (/^\d+$/.test(trimmed)) {
    const seconds = parseInt(trimmed, 10);
    return isNaN(seconds) ? null : seconds * 1000;
  }

  // Try parsing as HTTP-Date
  const dateMs = Date.parse(trimmed);
  if (!isNaN(dateMs)) {
    const delayMs = dateMs - Date.now();
    return delayMs > 0 ? delayMs : 0;
  }

  return null;
}
```

### 4.2 Exponential Backoff with Full Jitter
If no `Retry-After` header is provided (or if a network error occurs), `GeminiSpeechProvider` uses an exponential backoff strategy with **Full Jitter** to prevent thundering herd problems when resuming playback.

**Formula**:
$$\text{Backoff}_{\text{base}} = \min(\text{MaxDelay}, \text{BaseDelay} \times 2^{\text{attempt} - 1})$$
$$\text{SleepDelay} = \text{random}(0, \text{Backoff}_{\text{base}})$$

**Parameters**:
- `BaseDelay`: 500 ms
- `MaxDelay`: 10,000 ms (10 seconds)
- `MaxAttempts`: 3 attempts in provider, combined with `BufferedTTSClient` scheduling retries.

```typescript
export function calculateBackoffWithJitter(
  attempt: number,
  baseDelayMs = 500,
  maxDelayMs = 10000
): number {
  const temp = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt - 1));
  return Math.floor(Math.random() * temp);
}
```

---

## 5. Playback Loop Termination & State Machine Synchronization

### 5.1 Controller Event Loop Flow
When `GeminiTTSClient.speak()` executes:
1. `BufferedTTSClient.#runScheduler` iterates through sentences/marks.
2. If a sentence fails due to network or persistent rate limit issues after retries, `this.#consecutiveSkips` is incremented.
3. If `this.#consecutiveSkips > MAX_CONSECUTIVE_SKIPS` (3 consecutive unreachable sentences), `#runScheduler` stops fetching and pushes a `{ kind: 'error', message }` event into the queue.
4. `BufferedTTSClient.speak()` yields `{ code: 'error', message }` to `TTSController`.

```
┌────────────────────────┐      yields error      ┌────────────────────────┐
│   GeminiTTSClient /    ├───────────────────────►│     TTSController      │
│   BufferedTTSClient    │                        │  (#speak event loop)   │
└────────────────────────┘                        └───────────┬────────────┘
                                                              │
                                                              ▼
                                                   #terminate('error')
                                                              │
                                                              ▼
                                                   Dispatches 'tts-session-ended'
                                                   Resets state to 'stopped'
                                                   Clears 'playing' UI state
```

### 5.2 `TTSController` Error Handling Contract
In `TTSController.#speak()`:
```typescript
for await (const { code, message } of iter) {
  if (signal.aborted) {
    resolve();
    return;
  }
  lastCode = code;
}

if (lastCode === 'error' && !signal.aborted && this.state === 'playing') {
  console.error('[TTS] Session terminated due to unrecoverable error:', message);
  resolve();
  this.#terminate('error');
  await this.stop();
}
```

This guarantees that unrecoverable network or API errors cleanly reset the controller state (`this.state = 'stopped'`) and dispatch the `tts-session-ended` event, returning UI controls to the stopped/idle state rather than leaving the play button stuck in a loading or playing state.

---

## 6. Graceful Fallback Strategies

To ensure a smooth user experience even when Gemini Voice encounters API issues or key misconfigurations:

1. **Authentication Prompt (`tts-need-auth`)**:
   If Gemini API returns `HTTP 401` or `HTTP 403` (Invalid API Key), `TTSController` dispatches `tts-need-auth` to alert the user to check their API key in Settings.

2. **Cached Audio Playback**:
   If the device is offline or Gemini API rate limits are hit, `GeminiTTSClient` attempts to read previously synthesized audio segments from `BookTTSCacheStore`. Cached sentences play immediately without network requests.

3. **Fallback Engine Route (Optional / User Selection)**:
   If Gemini TTS fails continuously and no cached audio is available, the system halts cleanly and allows the user to switch to alternative engines (e.g., Edge TTS or Native System TTS) via the voice selection dropdown in the reader.

---

## 7. Step-by-Step Implementation Sequence

1. **Step 1: Implement Retry & Backoff Utilities**
   - Create `parseRetryAfterHeader` and `calculateBackoffWithJitter` helper functions in `apps/readest-app/src/services/tts/providers/gemini.ts`.
   - Write comprehensive unit tests in `apps/readest-app/src/__tests__/services/tts/GeminiSpeechProvider.test.ts`.

2. **Step 2: Update `GeminiSpeechProvider` Error Handling**
   - In `apps/readest-app/src/services/tts/providers/gemini.ts`, inspect response HTTP status codes.
   - Throw `SpeechSynthesisPermanentError` for HTTP 400, 401, 403, 404, or empty audio data.
   - For HTTP 429 and 5xx, parse `Retry-After` header or calculate exponential backoff delay, then wait before retrying inside `synthesize()`.

3. **Step 3: Integrate with `BufferedTTSClient` & `TTSController`**
   - Verify that `GeminiTTSClient` inherits `MAX_CONSECUTIVE_SKIPS` handling from `BufferedTTSClient`.
   - Ensure `TTSController.#speak()` handles `lastCode === 'error'` yielded by `GeminiTTSClient` by triggering `#terminate('error')` and `await this.stop()`.

4. **Step 4: Unit & Integration Testing**
   - Add unit tests in `GeminiSpeechProvider.test.ts` mocking `fetch` to simulate HTTP 429 (with `Retry-After`), HTTP 401 (permanent error), HTTP 500 (transient retry), and network disconnects.
   - Add integration tests verifying `TTSController` state transitions to `'stopped'` when `GeminiTTSClient` yields an `error` event.

5. **Step 5: Code Quality & Verification**
   - Run `pnpm exec biome check --write`.
   - Run type checker `NODE_OPTIONS="--max-old-space-size=4096" pnpm exec tsc --noEmit`.
   - Run all TTS-related test suites via `pnpm test`.

---

## 8. Acceptance & Verification Criteria

- [x] **HTTP 4xx Classification**: `HTTP 400`, `401`, `403`, and `404` throw `SpeechSynthesisPermanentError` immediately without retrying.
- [x] **HTTP 429 & 5xx Retries**: `HTTP 429` responses with `Retry-After` headers delay execution according to the header value. Transient `5xx` errors perform exponential backoff with full jitter.
- [x] **Loop Termination**: When 3 consecutive sentences fail, `GeminiTTSClient` yields `{ code: 'error' }`, causing `TTSController` to call `#terminate('error')` and set `state = 'stopped'`.
- [x] **UI State Reset**: In-app playback controls never freeze in "playing" state on unrecoverable API errors; controls cleanly revert to "stopped/paused".
- [x] **Type & Lint Safety**: Compiles cleanly with `tsc --noEmit` and passes `biome check`.
