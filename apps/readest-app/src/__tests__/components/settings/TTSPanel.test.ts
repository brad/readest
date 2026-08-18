import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { validateGeminiApiKey } from '@/components/settings/TTSPanel';

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
