import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import TTSPanel, { validateGeminiApiKey } from '@/components/settings/TTSPanel';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {} }),
}));

vi.mock('@/hooks/useResetViewSettings', () => ({
  useResetViewSettings: () => vi.fn(),
}));

const mockSaveViewSettings = vi.fn();
vi.mock('@/helpers/settings', () => ({
  saveViewSettings: (...args: unknown[]) => mockSaveViewSettings(...args),
}));

const mockViewSettings = {
  ttsMediaMetadata: 'sentence',
  ttsPlayerStyle: 'full',
  ttsHighlightGranularity: 'word',
  ttsHighlightOptions: { style: 'underline', color: '#ff0000' },
  geminiApiKey: 'test-api-key',
  geminiVoice: 'Puck',
};

const mockSettings = {
  globalViewSettings: mockViewSettings,
  globalReadSettings: {
    customTtsHighlightColors: [],
  },
};

vi.mock('@/store/readerStore', () => {
  const store = () => ({
    getViewSettings: () => mockViewSettings,
  });
  store.getState = () => ({
    bookKeys: [],
    getView: () => null,
    getViewState: () => null,
    getViewSettings: () => mockViewSettings,
    setViewSettings: vi.fn(),
  });
  return { useReaderStore: store };
});

vi.mock('@/store/settingsStore', () => {
  const store = () => ({
    settings: mockSettings,
    setSettings: vi.fn(),
    saveSettings: vi.fn(),
  });
  store.getState = () => ({
    settings: mockSettings,
    setSettings: vi.fn(),
    saveSettings: vi.fn(),
  });
  return { useSettingsStore: store };
});

vi.mock('@/services/tts/ttsCacheConfig', () => ({
  getTTSCacheConfig: () => ({ enabled: true, syncEnabled: false, budgetMB: 100 }),
  setTTSCacheConfig: vi.fn(),
}));

describe('validateGeminiApiKey', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('returns error when API key is empty', async () => {
    const result = await validateGeminiApiKey('   ');
    expect(result.success).toBe(false);
    expect(result.message).toContain('API key cannot be empty');
  });

  it('returns success when API returns 200 OK', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ models: [] }),
    } as unknown as Response);

    const result = await validateGeminiApiKey('valid-key');
    expect(result.success).toBe(true);
    expect(result.message).toContain('valid');
    expect(global.fetch).toHaveBeenCalledWith(
      'https://generativelanguage.googleapis.com/v1beta/models?key=valid-key',
      { method: 'GET' },
    );
  });

  it('returns error message when API returns 400/403 error', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      json: async () => ({ error: { message: 'API key not valid. Please pass a valid API key.' } }),
    } as unknown as Response);

    const result = await validateGeminiApiKey('invalid-key');
    expect(result.success).toBe(false);
    expect(result.message).toContain('API key not valid');
  });

  it('handles network failure gracefully', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Failed to fetch'));

    const result = await validateGeminiApiKey('some-key');
    expect(result.success).toBe(false);
    expect(result.message).toContain('Network error: Failed to fetch');
  });
});

describe('TTSPanel Component - Gemini Voice Section', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    global.fetch = originalFetch;
  });

  it('renders Gemini Voice section with masked API key input and voice select', () => {
    render(<TTSPanel bookKey='book1' onRegisterReset={vi.fn()} />);

    expect(screen.getByText('Gemini Voice (AI Speech)')).not.toBeNull();

    const apiKeyInput = screen.getByPlaceholderText('Paste API Key...') as HTMLInputElement;
    expect(apiKeyInput).not.toBeNull();
    expect(apiKeyInput.type).toBe('password');
    expect(apiKeyInput.value).toBe('test-api-key');

    const voiceSelect = screen.getByRole('combobox', { name: 'Gemini Voice' }) as HTMLSelectElement;
    expect(voiceSelect).not.toBeNull();
    expect(voiceSelect.value).toBe('Puck');
  });

  it('updates API key and calls saveViewSettings on change', () => {
    render(<TTSPanel bookKey='book1' onRegisterReset={vi.fn()} />);

    const apiKeyInput = screen.getByPlaceholderText('Paste API Key...') as HTMLInputElement;
    fireEvent.change(apiKeyInput, { target: { value: 'new-gemini-key' } });

    expect(apiKeyInput.value).toBe('new-gemini-key');
    expect(mockSaveViewSettings).toHaveBeenCalledWith(
      expect.anything(),
      'book1',
      'geminiApiKey',
      'new-gemini-key',
      false,
      false,
    );
  });

  it('updates selected voice and calls saveViewSettings on change', () => {
    render(<TTSPanel bookKey='book1' onRegisterReset={vi.fn()} />);

    const voiceSelect = screen.getByRole('combobox', { name: 'Gemini Voice' }) as HTMLSelectElement;
    fireEvent.change(voiceSelect, { target: { value: 'Charon' } });

    expect(voiceSelect.value).toBe('Charon');
    expect(mockSaveViewSettings).toHaveBeenCalledWith(
      expect.anything(),
      'book1',
      'geminiVoice',
      'Charon',
      false,
      false,
    );
  });

  it('handles Test validation button click and displays success feedback', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ models: [] }),
    } as unknown as Response);

    render(<TTSPanel bookKey='book1' onRegisterReset={vi.fn()} />);

    const testButton = screen.getByRole('button', { name: 'Test' });
    fireEvent.click(testButton);

    await waitFor(() => {
      expect(screen.getByText(/Gemini API key is valid!/i)).not.toBeNull();
    });
  });

  it('handles Test validation button click and displays failure feedback', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      json: async () => ({ error: { message: 'API key expired' } }),
    } as unknown as Response);

    render(<TTSPanel bookKey='book1' onRegisterReset={vi.fn()} />);

    const testButton = screen.getByRole('button', { name: 'Test' });
    fireEvent.click(testButton);

    await waitFor(() => {
      expect(screen.getByText(/API key expired/i)).not.toBeNull();
    });
  });
});
