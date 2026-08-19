# Phase 5B Specification & Implementation Plan: Integration, UI & Verification Testing

**Target Plan File**: `plans/gemini-voice/phase5b.md`
**Parent Plan**: `plans/gemini-voice/overview.md`
**Status**: Draft / Ready for Implementation

---

## 1. Overview & Objectives

Phase 5B focuses on higher-level integration testing, UI component testing, and overall repository quality verification for **Gemini Voice** in Readest.

By the end of Phase 5B:
1. **Client & Integration Testing**: `GeminiTTSClient` lifecycle, preloading queue execution, cache hit/miss behavior with `CachingProvider` / `BookTTSCacheStore`, and `TTSController` event loop termination on `code: 'error'` are verified via integration tests.
2. **UI & Settings Testing**: `TTSPanel.tsx` rendering, API key input masking, prebuilt voice dropdown selection, API key validation button interaction, and feedback state updates are verified via component tests.
3. **Repository Verification**: The entire codebase passes strict Biome formatting/linting, TypeScript compilation check, and full Vitest unit/integration test suites.

---

## 2. Target Test Files & Verification Strategy

| Test File Path | Description & Test Scenarios |
| --- | --- |
| `apps/readest-app/src/__tests__/services/tts/GeminiTTSClient.test.ts` | Integration tests for `GeminiTTSClient` initialization, `getAllVoices()`, `speak()` iterator, preloading, cache hits via `CachingProvider`, and `MAX_CONSECUTIVE_SKIPS` error yielding. |
| `apps/readest-app/src/__tests__/components/settings/TTSPanel.test.tsx` | Component tests for Gemini section rendering in `TTSPanel`, entering API Key, selecting voice, clicking "Test" validation button, and UI feedback states. |

---

## 3. Test Specifications & Verification Workflows

### 3.1 Integration Test Specification (`GeminiTTSClient.test.ts`)

```typescript
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { GeminiTTSClient } from '@/services/tts/GeminiTTSClient';

describe('GeminiTTSClient Integration', () => {
  let client: GeminiTTSClient;

  beforeEach(() => {
    vi.restoreAllMocks();
    client = new GeminiTTSClient();
  });

  test('populates available voices on init', async () => {
    await client.init();
    const voices = client.getAllVoices();
    expect(voices).toContainEqual(expect.objectContaining({ voiceURI: 'Puck', name: 'Puck' }));
    expect(voices).toContainEqual(expect.objectContaining({ voiceURI: 'Charon', name: 'Charon' }));
  });

  test('overrides capabilities with wordBoundaries false', () => {
    expect(client.getCapabilities()).toEqual({
      wordBoundaries: false,
    });
  });
});
```

### 3.2 Monorepo Quality & Verification Suite

Before completing the Gemini Voice feature, all changes must pass the following repository verification commands:

```bash
# 1. Format and Linting Check (Biome)
pnpm exec biome check --write

# 2. Strict TypeScript Compilation Check (Increased Heap Memory)
NODE_OPTIONS="--max-old-space-size=4096" pnpm exec tsc --noEmit

# 3. Complete Vitest Test Suite Execution
pnpm test
```

---

## 4. Acceptance Criteria

- [ ] `GeminiTTSClient.test.ts` passes, verifying client initialization, preloading, caching integration, and capability reporting.
- [ ] `TTSPanel.test.tsx` passes, verifying UI interactions, key masking, voice selection, and key validation.
- [ ] `pnpm exec biome check` reports zero linting or formatting errors across modified files.
- [ ] `tsc --noEmit` completes with zero TypeScript errors across the repository.
- [ ] `pnpm test` executes cleanly with all unit and integration test suites passing.
