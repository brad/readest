import React, { useEffect, useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useReaderStore } from '@/store/readerStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useResetViewSettings } from '@/hooks/useResetSettings';
import { useTranslation } from '@/hooks/useTranslation';
import { saveViewSettings } from '@/helpers/settings';
import { SettingsPanelPanelProp } from './SettingsDialog';
import { TTSMediaMetadataMode } from '@/services/tts/types';
import { BoxedList, SettingsRow, SettingsSelect, SettingsSwitchRow, SettingLabel } from './primitives';
import TTSHighlightStyleEditor, { TTSHighlightStyle } from './color/TTSHighlightStyleEditor';

const TTSPanel: React.FC<SettingsPanelPanelProp> = ({ bookKey, onRegisterReset }) => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const { getViewSettings } = useReaderStore();
  const { settings, setSettings, saveSettings } = useSettingsStore();
  const viewSettings = getViewSettings(bookKey) || settings.globalViewSettings;

  const [ttsMediaMetadata, setTtsMediaMetadata] = useState<TTSMediaMetadataMode>(
    viewSettings.ttsMediaMetadata ?? 'sentence',
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

  const [geminiTtsEnabled, setGeminiTtsEnabled] = useState(
    viewSettings.geminiTtsEnabled ?? false,
  );
  const [geminiTtsApiKey, setGeminiTtsApiKey] = useState(
    viewSettings.geminiTtsApiKey ?? '',
  );

  const resetToDefaults = useResetViewSettings();

  const handleReset = () => {
    resetToDefaults({
      ttsMediaMetadata: setTtsMediaMetadata as React.Dispatch<React.SetStateAction<string>>,
      geminiTtsEnabled: setGeminiTtsEnabled as React.Dispatch<React.SetStateAction<boolean>>,
      geminiTtsApiKey: setGeminiTtsApiKey as React.Dispatch<React.SetStateAction<string>>,
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
    if (geminiTtsEnabled === viewSettings.geminiTtsEnabled) return;
    saveViewSettings(envConfig, bookKey, 'geminiTtsEnabled', geminiTtsEnabled, false, false);
  }, [geminiTtsEnabled, bookKey, envConfig, viewSettings.geminiTtsEnabled]);

  useEffect(() => {
    if (geminiTtsApiKey === viewSettings.geminiTtsApiKey) return;
    saveViewSettings(envConfig, bookKey, 'geminiTtsApiKey', geminiTtsApiKey, false, false);
  }, [geminiTtsApiKey, bookKey, envConfig, viewSettings.geminiTtsApiKey]);

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

  return (
    <div className='my-4 w-full space-y-6'>
      <TTSHighlightStyleEditor
        style={ttsHighlightStyle}
        color={ttsHighlightColor}
        customColors={customTtsHighlightColors}
        onStyleChange={handleTTSStyleChange}
        onColorChange={handleTTSColorChange}
        onCustomColorsChange={handleCustomTtsColorsChange}
        data-setting-id='settings.tts.ttsHighlightStyle'
      />

      <BoxedList title={_('Enhanced TTS')} description={_('Use high-quality Gemini models for text-to-speech.')}>
        <SettingsSwitchRow
          label={_('Enable Gemini TTS')}
          checked={geminiTtsEnabled}
          onChange={() => setGeminiTtsEnabled(!geminiTtsEnabled)}
        />
        {geminiTtsEnabled && (
          <div className='flex flex-col gap-2 pe-4 py-3'>
            <div className='flex w-full items-center justify-between'>
              <SettingLabel>{_('Gemini API Key')}</SettingLabel>
              <a
                href='https://aistudio.google.com/app/apikey'
                target='_blank'
                rel='noopener noreferrer'
                className='link text-xs'
              >
                {_('Get Key')}
              </a>
            </div>
            <input
              type='password'
              className='input input-bordered input-sm w-full'
              value={geminiTtsApiKey}
              onChange={(e) => setGeminiTtsApiKey(e.target.value)}
              placeholder='AIza...'
              autoComplete='off'
            />
          </div>
        )}
      </BoxedList>

      <BoxedList title={_('Media Info')} data-setting-id='settings.tts.mediaMetadata'>
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
    </div>
  );
};

export default TTSPanel;
