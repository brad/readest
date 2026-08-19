# Phase 1 Specification & Implementation Plan: Settings, API Key Management & Configuration UI

**Target Plan File**: `plans/gemini-voice/phase1.md`  
**Parent Plan**: `plans/gemini-voice/overview.md`  
**Status**: Completed

---

## 1. Overview & Objectives

Phase 1 focuses on laying the foundational settings, state management, security protections, and user interface controls required for **Gemini Voice** in Readest. 

By the end of Phase 1, users will be able to:
1. Enter and store their Google Gemini API Key safely in Readest settings.
2. Retrieve available Gemini models dynamically via `GET v1beta/models?key={apiKey}` and select a model (`geminiModel`) to prevent 404 model errors across API model revisions.
3. Select a default Gemini prebuilt voice (e.g. Puck, Charon, Kore, Fenrir, Aoede) for TTS speech synthesis.
4. Validate their API Key directly in the UI and refresh the model list.
5. Export backups of their Readest configuration without leaking `geminiApiKey` in plain text.

---

## 2. Target Files & Key Components

| File Path | Description / Changes |
| --- | --- |
| `apps/readest-app/src/types/book.ts` | Extend `TTSConfig` interface with `geminiApiKey`, `geminiVoice`, and `geminiModel`. |
| `apps/readest-app/src/services/constants.ts` | Update `DEFAULT_TTS_CONFIG` defaults (`geminiModel: 'gemini-2.5-flash'`) and export `GEMINI_PREBUILT_VOICES` constants. |
| `apps/readest-app/src/services/backupService.ts` | Add `'globalViewSettings.geminiApiKey'` to `BACKUP_SETTINGS_CREDENTIAL_FIELDS`. |
| `apps/readest-app/src/components/settings/TTSPanel.tsx` | Add Gemini Voice settings section (API Key input, dynamic model selector dropdown, voice selector, test/validate button). |
| `apps/readest-app/src/__tests__/services/constants.test.ts` | Update default TTS config tests to check `geminiVoice`, `geminiApiKey`, and `geminiModel`. |
| `apps/readest-app/src/__tests__/services/backup-settings.test.ts` | Add tests confirming `geminiApiKey` is sanitized on backup export unless credentials are included. |
| `apps/readest-app/src/__tests__/components/settings/TTSPanel.test.ts` | Unit tests for Gemini API key validation and model list population. |

---

## 3. Detailed Data Structures & Types

### 3.1 `TTSConfig` Interface (`apps/readest-app/src/types/book.ts`)

```typescript
export interface TTSConfig {
  ttsRate: number;
  ttsSentenceGap: number;
  ttsParagraphGap: number;
  ttsVoice: string;
  ttsUseNarration: boolean;
  ttsLocation: string;
  ttsHighlightOptions: TTSHighlightOptions;
  ttsHighlightGranularity: TTSHighlightGranularity;
  ttsMediaMetadata: TTSMediaMetadataMode;
  ttsPlayerStyle: TTSPlayerStyle;

  // Gemini Voice Extensions
  geminiApiKey?: string;
  geminiVoice?: string;
  geminiModel?: string;
}
```

### 3.2 Prebuilt Voices Constants (`apps/readest-app/src/services/constants.ts`)

Gemini standard 2.0/2.5 prebuilt voices (24kHz PCM support):
```typescript
export const GEMINI_PREBUILT_VOICES = [
  { id: 'Puck', name: 'Puck (Enthusiastic / Male)', gender: 'male' },
  { id: 'Charon', name: 'Charon (Deep / Male)', gender: 'male' },
  { id: 'Kore', name: 'Kore (Calm / Female)', gender: 'female' },
  { id: 'Fenrir', name: 'Fenrir (Intense / Male)', gender: 'male' },
  { id: 'Aoede', name: 'Aoede (Warm / Female)', gender: 'female' },
] as const;

export const DEFAULT_GEMINI_VOICE = 'Puck';
export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';

export const DEFAULT_TTS_CONFIG: TTSConfig = {
  // ... existing defaults
  geminiApiKey: '',
  geminiVoice: DEFAULT_GEMINI_VOICE,
  geminiModel: DEFAULT_GEMINI_MODEL,
};
```

### 3.3 Backup Security (`apps/readest-app/src/services/backupService.ts`)

Ensure `geminiApiKey` is treated as a sensitive credential. When users generate an unencrypted backup (`.zip`), credential fields are stripped by `sanitizeSettingsForBackup` unless `includeCredentials: true` is explicitly opted into.

```typescript
export const BACKUP_SETTINGS_CREDENTIAL_FIELDS = [
  'kosync.username',
  'kosync.userkey',
  'kosync.password',
  'bookorbit.username',
  'bookorbit.userkey',
  'bookorbit.password',
  'readwise.accessToken',
  'hardcover.accessToken',
  's3.accessKeyId',
  's3.secretAccessKey',
  'aiSettings.aiGatewayApiKey',
  'aiSettings.openrouterApiKey',
  // Gemini TTS API Key
  'globalViewSettings.geminiApiKey',
] as const;
```

---

## 4. UI Specification (`TTSPanel.tsx`)

A new `BoxedList` section titled **Gemini Voice (AI Speech)** is provided in `apps/readest-app/src/components/settings/TTSPanel.tsx`:
1. **API Key Input**: Password-masked text input for `geminiApiKey`.
2. **Validate & Refresh Models Button**: Sends `GET https://generativelanguage.googleapis.com/v1beta/models?key={apiKey}`.
3. **Model Selection Dropdown**: Populated dynamically from `v1beta/models` response (filtering for models supporting `generateContent` or audio generation, e.g., `gemini-2.5-flash`, `gemini-2.0-flash`). Falls back to `gemini-2.5-flash` if list cannot be fetched.
4. **Voice Selection Dropdown**: Prebuilt Gemini voices (`Puck`, `Charon`, `Kore`, `Fenrir`, `Aoede`).

---

## 5. API Key Validation & Dynamic Model Retrieval Mechanism

To validate the user's API Key and prevent hardcoded 404 model errors as Google rolls out new Gemini model revisions:
1. Issue a `GET` request to `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`.
2. If successful (HTTP 200), parse the `models` array, extract model IDs (e.g., `models/gemini-2.5-flash` -> `gemini-2.5-flash`), and populate the model selection dropdown in `TTSPanel.tsx`.
3. Save the user's selected `geminiModel` in settings so subsequent TTS synthesis requests invoke `v1beta/models/${geminiModel}:generateContent`.

---

## 6. Acceptance & Verification Criteria

- [x] **Type Integrity**: `geminiApiKey`, `geminiVoice`, and `geminiModel` on `TTSConfig`.
- [x] **Persistence**: Settings entered in `TTSPanel` (`geminiApiKey`, `geminiModel`, `geminiVoice`) persist to `settingsStore` / `globalViewSettings`.
- [x] **Dynamic Model Selection**: Querying `v1beta/models` populates available Gemini models in the settings dropdown.
- [x] **Backup Security**: Exporting a settings backup without credentials strips `geminiApiKey`. Exporting with credentials includes `geminiApiKey`.
- [x] **UI Validation**: Testing a valid API key shows green success text and updates available models; testing an invalid key displays an error message without crashing.
- [x] **Linting & Code Style**: Passes `pnpm exec biome check` without formatting errors.
