/**
 * 配色：深色 / 浅色 / 跟随系统，外加用户自己挑的主色。
 *
 * 所有颜色最终都落在 CSS 变量上，切换只改 <html data-theme> 和几个内联变量，
 * 不触发 React 重排；图形部分（泳道、热力图）从变量里取色，跟着一起变。
 */

export type ThemeMode = 'dark' | 'light' | 'system';
export type ResolvedMode = 'dark' | 'light';

export interface ThemeSettings {
  mode: ThemeMode;
  /** null 表示用主题自带的主色 */
  accent: string | null;
}

const STORAGE_KEY = 'gitatlas.theme.v1';

/** 手动挑的几个主色，覆盖冷、暖、中性三类 */
export const ACCENT_PRESETS: Array<{ name: string; value: string }> = [
  { name: '青蓝', value: '#7aa2f7' },
  { name: '薄荷', value: '#3fbf9a' },
  { name: '紫罗兰', value: '#9a7cf0' },
  { name: '琥珀', value: '#d99a45' },
  { name: '珊瑚', value: '#ef6f88' },
  { name: '湖蓝', value: '#38a9d8' },
];

const DEFAULT_ACCENT: Record<ResolvedMode, string> = {
  dark: '#7aa2f7',
  light: '#3b6fe0',
};

const DEFAULTS: ThemeSettings = { mode: 'dark', accent: null };

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function normalizeHex(input: string): string | null {
  const text = input.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(text)) {
    return `#${text
      .split('')
      .map((char) => char + char)
      .join('')}`.toLowerCase();
  }
  if (/^[0-9a-f]{6}$/i.test(text)) return `#${text.toLowerCase()}`;
  return null;
}

function hexToRgb(hex: string): [number, number, number] {
  const value = normalizeHex(hex) ?? '#7aa2f7';
  return [
    Number.parseInt(value.slice(1, 3), 16),
    Number.parseInt(value.slice(3, 5), 16),
    Number.parseInt(value.slice(5, 7), 16),
  ];
}

function rgbToHex(rgb: [number, number, number]): string {
  return `#${rgb.map((part) => clamp(Math.round(part), 0, 255).toString(16).padStart(2, '0')).join('')}`;
}

/** 把 a 往 b 混，amount 是 b 的占比 */
function mix(a: string, b: string, amount: number): string {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  return rgbToHex([ar + (br - ar) * amount, ag + (bg - ag) * amount, ab + (bb - ab) * amount]);
}

/** 相对亮度，用来决定主色上该放黑字还是白字 */
function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((value) => {
    const unit = value / 255;
    return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** 主色上的字：黑白哪个对比更强用哪个，浅色主色（薄荷、琥珀）不再白字糊成一片 */
function inkFor(accent: string): string {
  const withDark = (luminance(accent) + 0.05) / (luminance('#0a1020') + 0.05);
  const withWhite = 1.05 / (luminance(accent) + 0.05);
  return withDark >= withWhite ? '#0a1020' : '#ffffff';
}

export function resolvedMode(mode: ThemeMode): ResolvedMode {
  if (mode !== 'system') return mode;
  if (typeof window === 'undefined') return 'dark';
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function loadTheme(): ThemeSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<ThemeSettings>;
    const mode: ThemeMode =
      parsed.mode === 'light' || parsed.mode === 'system' || parsed.mode === 'dark' ? parsed.mode : 'dark';
    const accent = typeof parsed.accent === 'string' ? normalizeHex(parsed.accent) : null;
    return { mode, accent };
  } catch {
    return DEFAULTS;
  }
}

export function saveTheme(settings: ThemeSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // 隐私模式下写不进去，界面照样能切，下次开还是默认
  }
}

/**
 * 把设置落到 DOM 上。主色由用户指定时，其余几档（深/亮/正文色/按钮上的字）
 * 都由它算出来，保证不管挑什么颜色，按钮文字和强调文字都还看得清。
 */
export function applyTheme(settings: ThemeSettings): ResolvedMode {
  const mode = resolvedMode(settings.mode);
  const root = document.documentElement;
  root.dataset.theme = mode;
  root.style.colorScheme = mode;

  const accent = settings.accent ?? DEFAULT_ACCENT[mode];
  const rgb = hexToRgb(accent);
  const strong = mode === 'dark' ? mix(accent, '#000000', 0.22) : mix(accent, '#000000', 0.24);
  const bright = mode === 'dark' ? mix(accent, '#ffffff', 0.38) : mix(accent, '#000000', 0.12);
  const text = mode === 'dark' ? mix(accent, '#ffffff', 0.45) : mix(accent, '#000000', 0.32);
  const ink = inkFor(accent);

  root.style.setProperty('--accent', accent);
  root.style.setProperty('--accent-rgb', rgb.join(' '));
  root.style.setProperty('--accent-strong', strong);
  root.style.setProperty('--accent-strong-rgb', hexToRgb(strong).join(' '));
  root.style.setProperty('--accent-bright', bright);
  root.style.setProperty('--accent-text', text);
  root.style.setProperty('--accent-ink', ink);

  return mode;
}

/** 跟随系统时，系统换主题要跟着动 */
export function watchSystemTheme(onChange: () => void): () => void {
  const query = window.matchMedia('(prefers-color-scheme: light)');
  const handler = () => onChange();
  query.addEventListener('change', handler);
  return () => query.removeEventListener('change', handler);
}
