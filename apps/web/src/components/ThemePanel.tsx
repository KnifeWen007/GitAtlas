import { useTranslation } from '../i18n.ts';
import { useEffect, useRef, useState } from 'react';
import {
  ACCENT_PRESETS,
  normalizeHex,
  type ResolvedMode,
  type ThemeMode,
  type ThemeSettings,
} from '../theme.ts';

interface ThemePanelProps {
  settings: ThemeSettings;
  resolved: ResolvedMode;
  onChange: (next: ThemeSettings) => void;
}

const MODES: Array<{ value: ThemeMode; label: string }> = [
  { value: 'dark', label: '深色' },
  { value: 'light', label: '浅色' },
  { value: 'system', label: '跟随系统' },
];

/**
 * 配色面板：外观三选一 + 主色。
 * 主色既可以从预设里挑，也可以直接用取色器选一个，配色只存在本机。
 */
export function ThemePanel({ settings, resolved, onChange }: ThemePanelProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const dockRef = useRef<HTMLDivElement>(null);
  const currentAccent = settings.accent ?? (resolved === 'dark' ? '#7aa2f7' : '#3b6fe0');

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!dockRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className="theme-dock" ref={dockRef}>
      {open ? (
        <div className="theme-pop" role="dialog" aria-label={t("配色")}>
          <div className="theme-pop-head">
            <span>{t("配色")}</span>
            <button className="theme-close" type="button" onClick={() => setOpen(false)} aria-label={t("关闭")}>
              ×
            </button>
          </div>

          <div className="theme-field">
            <span className="theme-field-label">{t("外观")}</span>
            <div className="theme-seg">
              {MODES.map((mode) => (
                <button
                  key={mode.value}
                  type="button"
                  className={settings.mode === mode.value ? 'is-on' : ''}
                  onClick={() => onChange({ ...settings, mode: mode.value })}
                >
                  {t(mode.label)}
                </button>
              ))}
            </div>
          </div>

          <div className="theme-field">
            <span className="theme-field-label">{t("主色")}</span>
            <div className="theme-swatches">
              {ACCENT_PRESETS.map((preset) => (
                <button
                  key={preset.value}
                  type="button"
                  className={`theme-swatch ${settings.accent === preset.value ? 'is-on' : ''}`}
                  style={{ background: preset.value }}
                  title={t(preset.name)}
                  aria-label={t("主色 {0}", t(preset.name))}
                  onClick={() => onChange({ ...settings, accent: preset.value })}
                />
              ))}
              <label className="theme-swatch theme-swatch-custom" title={t("自己挑一个")}>
                <input
                  type="color"
                  value={currentAccent}
                  onChange={(event) => {
                    const next = normalizeHex(event.target.value);
                    if (next) onChange({ ...settings, accent: next });
                  }}
                />
              </label>
              <button
                type="button"
                className="theme-reset"
                onClick={() => onChange({ ...settings, accent: null })}
              >
                {t("默认")}
              </button>
            </div>
          </div>

          <p className="theme-hint">{t("配色只存在这台机器上，不会写进仓库。")}</p>
        </div>
      ) : null}

      <button className="theme-trigger" type="button" onClick={() => setOpen((value) => !value)}>
        <span className="theme-trigger-dot" />
        {t("配色 ·")} {resolved === 'dark' ? t("深色") : t("浅色")}
      </button>
    </div>
  );
}
