# Phase 1 Specification & Implementation Plan: Settings, API Key Management & Configuration UI

**Target Plan File**: `plans/gemini-voice/phase1.md`  
**Parent Plan**: `plans/gemini-voice/overview.md`  
**Status**: Draft / Pending Implementation

---

## 1. Overview & Objectives

Phase 1 focuses on laying the foundational settings, state management, security protections, and user interface controls required for **Gemini Voice** in Readest. 

By the end of Phase 1, users will be able to:
1. Enter and store their Google Gemini API Key safely in Readest settings.
2. Select a default Gemini prebuilt voice (e.g. Puck, Charon, Kore, Fenrir, Aoede) for TTS speech synthesis.
3. Validate their API Key directly in the UI using Gemini's REST endpoint.
4. Export backups of their Readest configuration without leaking `geminiApiKey` in plain text.

---

## 2. Target Files & Key Components

| File Path | Description / Changes |
| --- | --- |
| `apps/readest-app/src/types/book.ts` | Extend `TTSConfig` interface with `geminiApiKey` and `geminiVoice`. |
| `apps/readest-app/src/services/constants.ts` | Update `DEFAULT_TTS_CONFIG` defaults and export `GEMINI_VOICES` constants. |
| `apps/readest-app/src/services/backupService.ts` | Add `'globalViewSettings.geminiApiKey'` (or `ttsConfig.geminiApiKey`) to `BACKUP_SETTINGS_CREDENTIAL_FIELDS`. |
| `apps/readest-app/src/components/settings/TTSPanel.tsx` | Add Gemini Voice settings section (API Key input, voice selector, test/validate button). |
| `apps/readest-app/src/__tests__/services/constants.test.ts` | Update default TTS config tests to check `geminiVoice` and `geminiApiKey`. |
| `apps/readest-app/src/__tests__/services/backup-settings.test.ts` | Add tests confirming `geminiApiKey` is sanitized on backup export unless credentials are included. |
| `apps/readest-app/src/__tests__/components/settings/TTSPanel.test.tsx` | Unit tests for Gemini settings UI interaction and key validation. |

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

export const DEFAULT_TTS_CONFIG: TTSConfig = {
  // ... existing defaults
  geminiApiKey: '',
  geminiVoice: DEFAULT_GEMINI_VOICE,
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

A new `BoxedList` section titled **Gemini Voice (AI Speech)** will be added to `apps/readest-app/src/components/settings/TTSPanel.tsx`:

```tsx
<BoxedList title={_('Gemini Voice (AI Speech)')} data-setting-id='settings.tts.geminiVoice'>
  {/* Gemini API Key Field */}
  <SettingsRow label={_('Gemini API Key')}>
    <div className='flex items-center gap-2 w-full max-w-xs'>
      <input
        type='password'
        value={geminiApiKey}
        onChange={(e) => setGeminiApiKey(e.target.value)}
        placeholder={_('Paste API Key...')}
        className='input-style'
      />
      <button
        onClick={handleValidateApiKey}
        disabled={isValidating || !geminiApiKey}
        className='btn-secondary text-xs px-2 py-1'
      >
        {isValidating ? _('Checking...') : _('Test')}
      </button>
    </div>
  </SettingsRow>

  {/* Status / Validation Message */}
  {validationStatus && (
    <div className={`text-xs px-3 py-1 ${validationStatus.success ? 'text-green-500' : 'text-red-500'}`}>
      {validationStatus.message}
    </div>
  )}

  {/* Voice Selection Dropdown */}
  <SettingsRow label={_('Gemini Voice')}>
    <SettingsSelect
      value={geminiVoice}
      onChange={(e) => setGeminiVoice(e.target.value)}
      ariaLabel={_('Gemini Voice')}
      options={GEMINI_PREBUILT_VOICES.map((v) => ({
        value: v.id,
        label: v.name,
      }))}
    />
  </SettingsRow>
</BoxedList>
```

---

## 5. API Key Validation Mechanism

To validate the user's API Key without invoking paid/heavy audio synthesis, perform a lightweight `GET` request against the Gemini REST API `v1beta/models` endpoint.

### Validation Endpoint
- **URL**: `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
- **Method**: `GET`
- **Expected Response**:
  - `HTTP 200`: Key is valid and active.
  - `HTTP 400` / `HTTP 403`: Key is invalid or restricted.
  - `HTTP 429`: Rate limit exceeded.

```typescript
export async function validateGeminiApiKey(apiKey: string): Promise<{ success: boolean; message: string }> {
  if (!apiKey.trim()) {
    return { success: false, message: 'API key cannot be empty.' };
  }
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`,
      { method: 'GET' }
    );
    if (response.ok) {
      return { success: true, message: 'Gemini API Key is valid!' };
    }
    const errData = await response.json().catch(() => ({}));
    const errorMessage = errData?.error?.message || `HTTP ${response.status} ${response.statusText}`;
    return { success: false, message: `Validation failed: ${errorMessage}` };
  } catch (err: any) {
    return { success: false, message: `Network error: ${err.message || String(err)}` };
  }
}
```

---

## 6. Step-by-Step Implementation Sequence

1. **Step 1: Extend Interfaces & Types**
   - Update `TTSConfig` in `apps/readest-app/src/types/book.ts` to include optional `geminiApiKey?: string` and `geminiVoice?: string`.
2. **Step 2: Update Defaults & Export Voice Options**
   - Update `DEFAULT_TTS_CONFIG` in `apps/readest-app/src/services/constants.ts` with default values (`geminiApiKey: ''`, `geminiVoice: 'Puck'`).
   - Define and export `GEMINI_PREBUILT_VOICES` array.
3. **Step 3: Secure Credential Sanitization in Backups**
   - Add `'globalViewSettings.geminiApiKey'` to `BACKUP_SETTINGS_CREDENTIAL_FIELDS` in `apps/readest-app/src/services/backupService.ts`.
4. **Step 4: Build Settings UI Controls**
   - Implement Gemini Voice section in `apps/readest-app/src/components/settings/TTSPanel.tsx`.
   - Wire input handlers with `saveViewSettings(envConfig, bookKey, 'geminiApiKey', value)` and `saveViewSettings(envConfig, bookKey, 'geminiVoice', value)`.
5. **Step 5: Add Unit & Integration Tests**
   - Update `apps/readest-app/src/__tests__/services/constants.test.ts` to assert default Gemini fields.
   - Update `apps/readest-app/src/__tests__/services/backup-settings.test.ts` to verify `geminiApiKey` is sanitized on export.
   - Add component unit test in `apps/readest-app/src/__tests__/components/settings/TTSPanel.test.tsx` testing Gemini UI rendering and API validation triggering.

---

## 7. Acceptance & Verification Criteria

- [ ] **Type Integrity**: `tsc --noEmit` compiles cleanly with `geminiApiKey` and `geminiVoice` on `TTSConfig`.
- [ ] **Persistence**: Settings entered in `TTSPanel` persist to `settingsStore` / `globalViewSettings` and survive app restarts.
- [ ] **Backup Security**: Exporting a settings backup without credentials strips `geminiApiKey`. Exporting with credentials includes `geminiApiKey`.
- [ ] **UI Validation**: Testing a valid API key shows green success text; testing an invalid key displays an error message without crashing.
- [ ] **Linting & Code Style**: Passes `pnpm exec biome check` without formatting errors.
