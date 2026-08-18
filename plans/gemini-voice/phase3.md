# Phase 3: Resilience, Error Handling & Rate Limiting

## Status: Completed

## 1. Overview
Phase 3 builds rate-limiting resilience, retry capabilities, exponential backoff, and error-handling mechanisms into `GeminiSpeechProvider`. This ensures that temporary network errors, HTTP 429 rate limits, and server-side disruptions do not cause playback crashes or freeze UI states, while permanent errors (such as invalid API keys) fail fast and cleanly terminate the playback session.

---

## 2. Key Deliverables & Affected Files

| Component / File | Purpose / Description |
| --- | --- |
| `apps/readest-app/src/services/tts/providers/gemini.ts` | Added `parseRetryAfterHeader`, `calculateBackoffWithJitter`, `sleep` utility functions, and enhanced `GeminiSpeechProvider.synthesize` retry loop with strict error classification. |
| `apps/readest-app/src/__tests__/services/tts/GeminiSpeechProvider.test.ts` | Unit tests for error classification, `Retry-After` header parsing, backoff delay calculations, pre-aborted/sleep cancellation, and retry loops. |

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

- **HTTP 429 Too Many Requests**: Rate limit or quota exceeded (RPM/TPM limit).
- **HTTP 500 Internal Server Error**: Gemini backend service internal error.
- **HTTP 502 Bad Gateway / HTTP 503 Service Unavailable / HTTP 504 Gateway Timeout**: Temporary API gateway or upstream availability issue.
- **Network / Fetch Errors**: Browser `TypeError` due to temporary network disconnection or DNS lookup failure.

---

## 4. Rate Limiting, `Retry-After` Parsing & Backoff Algorithm

### 4.1 `Retry-After` Header Parsing
When Gemini returns an `HTTP 429` or `HTTP 503` response, it may include a `Retry-After` header indicating how long to wait before sending another request. `GeminiSpeechProvider` parses both standard formats via `parseRetryAfterHeader()`:

1. **Seconds (Integer)**: e.g. `Retry-After: 5` -> Wait 5000ms.
2. **HTTP-Date (RFC 7231)**: e.g. `Retry-After: Wed, 21 Oct 2025 07:28:00 GMT` -> Calculate `Date.parse(header) - Date.now()`.

### 4.2 Exponential Backoff with Full Jitter
If no `Retry-After` header is provided (or if a network error occurs), `GeminiSpeechProvider` uses `calculateBackoffWithJitter()` for exponential backoff with **Full Jitter**:

$$\text{Backoff}_{\text{base}} = \min(\text{MaxDelay}, \text{BaseDelay} \times 2^{\text{attempt} - 1})$$
$$\text{SleepDelay} = \text{random}(0, \text{Backoff}_{\text{base}})$$

---

## 5. Acceptance & Verification Criteria

- [x] **HTTP 4xx Classification**: `HTTP 400`, `401`, `403`, and `404` throw `SpeechSynthesisPermanentError` immediately without retrying.
- [x] **HTTP 429 & 5xx Retries**: `HTTP 429` responses with `Retry-After` headers delay execution according to the header value. Transient `5xx` errors perform exponential backoff with full jitter.
- [x] **Loop Termination**: When 3 consecutive sentences fail, `GeminiTTSClient` yields `{ code: 'error' }`, causing `TTSController` to call `#terminate('error')` and set `state = 'stopped'`.
- [x] **UI State Reset**: In-app playback controls never freeze in "playing" state on unrecoverable API errors; controls cleanly revert to "stopped/paused".
- [x] **Type & Lint Safety**: Compiles cleanly with `tsc --noEmit` and passes `biome check`.
