import React, { useEffect, useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useReaderStore } from '@/store/readerStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useResetViewSettings } from '@/hooks/useResetSettings';
import { useTranslation } from '@/hooks/useTranslation';
import { saveViewSettings } from '@/helpers/settings';
import {
  DEFAULT_GEMINI_MODEL,
  DEFAULT_GEMINI_VOICE,
  GEMINI_PREBUILT_VOICES,
} from '@/services/constants';
import { SettingsPanelPanelProp } from './SettingsDialog';
import {
  TTSHighlightGranularity,
  TTSMediaMetadataMode,
  TTSPlayerStyle,
} from '@/services/tts/types';
import { getTTSCacheConfig, setTTSCacheConfig } from '@/services/tts/providers/bookCacheStore';
import { BoxedList, SettingsRow, SettingsSelect, SettingsSwitchRow } from './primitives';
import TTSHighlightStyleEditor, { TTSHighlightStyle } from './theme/TTSHighlightStyleEditor';

export async function validateGeminiApiKey(
  apiKey: string,
): Promise<{ success: boolean; message: string; models?: string[] }> {
  if (!apiKey.trim()) {
    return { success: false, message: 'API key cannot be empty.' };
  }
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`,
      { method: 'GET' },
    );
    if (response.ok) {
      const data = await response.json().catch(() => ({}));
      const rawModels: Array<{ name?: string; supportedGenerationMethods?: string[] }> =
        data?.models || [];
      const models = rawModels
        .filter(
          (m) =>
            m.name &&
            (!m.supportedGenerationMethods ||
              m.supportedGenerationMethods.includes('generateContent')),
        )
        .map((m) => m.name!.replace(/^models\//, ''));
      return { success: true, message: 'Gemini API Key is valid!', models };
    }
    const errData = await response.json().catch(() => ({}));
    const errorMessage =
      errData?.error?.message || `HTTP ${response.status} ${response.statusText}`;
    return { success: false, message: `Validation failed: ${errorMessage}` };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, message: `Network error: ${message}` };
  }
}

const TTSPanel: React.FC<SettingsPanelPanelProp> = ({ bookKey, onRegisterReset }) => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const { getViewSettings } = useReaderStore();
  const { settings, setSettings, saveSettings } = useSettingsStore();
  const viewSettings = getViewSettings(bookKey) || settings.globalViewSettings;

  const [ttsMediaMetadata, setTtsMediaMetadata] = useState<TTSMediaMetadataMode>(
    viewSettings.ttsMediaMetadata ?? 'sentence',
  );
  const [ttsPlayerStyle, setTtsPlayerStyle] = useState<TTSPlayerStyle>(
    viewSettings.ttsPlayerStyle ?? 'full',
  );
  const [ttsHighlightGranularity, setTtsHighlightGranularity] = useState<TTSHighlightGranularity>(
    viewSettings.ttsHighlightGranularity ?? 'word',
  );
  const [ttsHighlightStyle, setTtsHighlightStyle] = useState(
    viewSettings.ttsHighlightOptions.style,
  );
  const [ttsHighlightColor, setTtsHighlightColor] = useState(
    viewSettings.ttsHighlightOptions.color,
  );
  const [customTtsHighlightColors, setCustomTtsHighlightColors] = useState(
    settings.globalReadSettings.customTtsHighlightColors || [],
  );

  const [geminiApiKey, setGeminiApiKey] = useState(viewSettings.geminiApiKey ?? '');
  const [geminiVoice, setGeminiVoice] = useState(viewSettings.geminiVoice ?? DEFAULT_GEMINI_VOICE);
  const [geminiModel, setGeminiModel] = useState(viewSettings.geminiModel ?? DEFAULT_GEMINI_MODEL);
  const [availableModels, setAvailableModels] = useState<Array<{ value: string; label: string }>>([
    { value: 'gemini-2.5-flash', label: 'gemini-2.5-flash' },
    { value: 'gemini-2.0-flash', label: 'gemini-2.0-flash' },
    { value: 'gemini-1.5-flash', label: 'gemini-1.5-flash' },
  ]);
  const [isValidatingKey, setIsValidatingKey] = useState(false);
  const [validationStatus, setValidationStatus] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  const [ttsCacheConfig, setTtsCacheConfigState] = useState(getTTSCacheConfig());

  const updateTTSCacheConfig = (config: typeof ttsCacheConfig) => {
    setTtsCacheConfigState(config);
    setTTSCacheConfig(config);
  };

  const resetToDefaults = useResetViewSettings();

  const handleReset = () => {
    resetToDefaults({
      ttsMediaMetadata: setTtsMediaMetadata as React.Dispatch<React.SetStateAction<string>>,
      ttsPlayerStyle: setTtsPlayerStyle as React.Dispatch<React.SetStateAction<string>>,
      ttsHighlightGranularity: setTtsHighlightGranularity as React.Dispatch<
        React.SetStateAction<string>
      >,
      geminiApiKey: setGeminiApiKey as React.Dispatch<React.SetStateAction<string>>,
      geminiVoice: setGeminiVoice as React.Dispatch<React.SetStateAction<string>>,
      geminiModel: setGeminiModel as React.Dispatch<React.SetStateAction<string>>,
    });
  };

  useEffect(() => {
    onRegisterReset(handleReset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (ttsMediaMetadata === viewSettings.ttsMediaMetadata) return;
    saveViewSettings(envConfig, bookKey, 'ttsMediaMetadata', ttsMediaMetadata, false, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ttsMediaMetadata]);

  useEffect(() => {
    if (ttsPlayerStyle === viewSettings.ttsPlayerStyle) return;
    saveViewSettings(envConfig, bookKey, 'ttsPlayerStyle', ttsPlayerStyle, false, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ttsPlayerStyle]);

  useEffect(() => {
    if (ttsHighlightGranularity === viewSettings.ttsHighlightGranularity) return;
    saveViewSettings(
      envConfig,
      bookKey,
      'ttsHighlightGranularity',
      ttsHighlightGranularity,
      false,
      false,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ttsHighlightGranularity]);

  useEffect(() => {
    if (geminiApiKey === viewSettings.geminiApiKey) return;
    saveViewSettings(envConfig, bookKey, 'geminiApiKey', geminiApiKey, false, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geminiApiKey]);

  useEffect(() => {
    if (geminiVoice === viewSettings.geminiVoice) return;
    saveViewSettings(envConfig, bookKey, 'geminiVoice', geminiVoice, false, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geminiVoice]);

  useEffect(() => {
    if (geminiModel === viewSettings.geminiModel) return;
    saveViewSettings(envConfig, bookKey, 'geminiModel', geminiModel, false, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geminiModel]);

  const handleValidateApiKey = async () => {
    setIsValidatingKey(true);
    setValidationStatus(null);
    const result = await validateGeminiApiKey(geminiApiKey);
    setValidationStatus(result);
    if (result.success && result.models && result.models.length > 0) {
      setAvailableModels(result.models.map((m) => ({ value: m, label: m })));
    }
    setIsValidatingKey(false);
  };

  const handleTTSStyleChange = (style: TTSHighlightStyle) => {
    setTtsHighlightStyle(style);
    saveViewSettings(envConfig, bookKey, 'ttsHighlightOptions', {
      style,
      color: ttsHighlightColor,
    });
  };

  const handleTTSColorChange = (color: string) => {
    setTtsHighlightColor(color);
    saveViewSettings(envConfig, bookKey, 'ttsHighlightOptions', {
      style: ttsHighlightStyle,
      color,
    });
  };

  const handleCustomTtsColorsChange = (colors: string[]) => {
    setCustomTtsHighlightColors(colors);
    settings.globalReadSettings.customTtsHighlightColors = colors;
    setSettings(settings);
    saveSettings(envConfig, settings);
  };

  const handleMediaMetadataChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    setTtsMediaMetadata(event.target.value as TTSMediaMetadataMode);
  };

  const handlePlayerStyleChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    setTtsPlayerStyle(event.target.value as TTSPlayerStyle);
  };

  const handleTTSGranularityChange = (granularity: TTSHighlightGranularity) => {
    setTtsHighlightGranularity(granularity);
  };

  return (
    <div className='my-4 w-full space-y-6'>
      <TTSHighlightStyleEditor
        granularity={ttsHighlightGranularity}
        style={ttsHighlightStyle}
        color={ttsHighlightColor}
        customColors={customTtsHighlightColors}
        onGranularityChange={handleTTSGranularityChange}
        onStyleChange={handleTTSStyleChange}
        onColorChange={handleTTSColorChange}
        onCustomColorsChange={handleCustomTtsColorsChange}
        data-setting-id='settings.tts.ttsHighlightStyle'
      />

      <BoxedList title={_('Gemini Voice (AI Speech)')} data-setting-id='settings.tts.geminiVoice'>
        <SettingsRow label={_('Gemini API Key')}>
          <div className='flex items-center gap-2 w-full max-w-xs'>
            <input
              type='password'
              value={geminiApiKey}
              onChange={(e) => setGeminiApiKey(e.target.value)}
              placeholder={_('Paste API Key...')}
              className='w-full rounded border border-neutral-300 dark:border-neutral-700 bg-transparent px-2 py-1 text-sm'
            />
            <button
              type='button'
              onClick={handleValidateApiKey}
              disabled={isValidatingKey || !geminiApiKey}
              className='rounded bg-neutral-200 dark:bg-neutral-800 px-3 py-1 text-xs font-medium hover:bg-neutral-300 dark:hover:bg-neutral-700 disabled:opacity-50'
            >
              {isValidatingKey ? _('Checking...') : _('Test')}
            </button>
          </div>
        </SettingsRow>

        {validationStatus && (
          <div
            className={`text-xs px-3 py-1 ${validationStatus.success ? 'text-green-500' : 'text-red-500'}`}
          >
            {validationStatus.message}
          </div>
        )}

        <SettingsRow label={_('Gemini Model')}>
          <SettingsSelect
            value={geminiModel}
            onChange={(e) => setGeminiModel(e.target.value)}
            ariaLabel={_('Gemini Model')}
            options={
              availableModels.some((m) => m.value === geminiModel)
                ? availableModels
                : [{ value: geminiModel, label: geminiModel }, ...availableModels]
            }
          />
        </SettingsRow>

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

      <BoxedList title={_('Media Info')} data-setting-id='settings.tts.mediaMetadata'>
        <SettingsRow label={_('Player Style')} data-setting-id='settings.tts.playerStyle'>
          <SettingsSelect
            value={ttsPlayerStyle}
            onChange={handlePlayerStyleChange}
            ariaLabel={_('Player Style')}
            options={[
              { value: 'full', label: _('Full') },
              { value: 'minimal', label: _('Minimal') },
            ]}
          />
        </SettingsRow>
        <SettingsRow label={_('Update Frequency')}>
          <SettingsSelect
            value={ttsMediaMetadata}
            onChange={handleMediaMetadataChange}
            ariaLabel={_('Update Frequency')}
            options={[
              { value: 'sentence', label: _('Every Sentence') },
              { value: 'paragraph', label: _('Every Paragraph') },
              { value: 'chapter', label: _('Every Chapter') },
            ]}
          />
        </SettingsRow>
      </BoxedList>

      <BoxedList title={_('Audio Cache')} data-setting-id='settings.tts.audioCache'>
        <SettingsSwitchRow
          label={_('Cache Synthesized Audio')}
          description={_('Reuse generated speech across sessions without refetching')}
          checked={ttsCacheConfig.enabled}
          onChange={() =>
            updateTTSCacheConfig({ ...ttsCacheConfig, enabled: !ttsCacheConfig.enabled })
          }
          data-setting-id='settings.tts.audioCacheEnabled'
        />
        <SettingsSwitchRow
          label={_('Sync Audio Cache')}
          description={_('Share section audio between your devices through your file sync service')}
          checked={ttsCacheConfig.syncEnabled}
          disabled={!ttsCacheConfig.enabled}
          onChange={() =>
            updateTTSCacheConfig({ ...ttsCacheConfig, syncEnabled: !ttsCacheConfig.syncEnabled })
          }
          data-setting-id='settings.tts.audioCacheSync'
        />
        <SettingsRow label={_('Storage Limit')}>
          <SettingsSelect
            value={String(ttsCacheConfig.budgetMB)}
            onChange={(event) =>
              updateTTSCacheConfig({
                ...ttsCacheConfig,
                budgetMB: Number(event.target.value),
              })
            }
            ariaLabel={_('Storage Limit')}
            disabled={!ttsCacheConfig.enabled}
            options={[
              { value: '50', label: '50 MB' },
              { value: '100', label: '100 MB' },
              { value: '200', label: '200 MB' },
              { value: '500', label: '500 MB' },
              { value: '1024', label: '1 GB' },
            ]}
          />
        </SettingsRow>
      </BoxedList>
    </div>
  );
};

export default TTSPanel;
