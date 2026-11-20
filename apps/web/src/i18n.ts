import { english } from './translations.ts';
import { createContext, useContext } from 'react';

export type Language = 'zh-CN' | 'en';

export const LanguageContext = createContext<Language>('zh-CN');

const STORAGE_KEY = 'gitatlas.language';
let language: Language = 'zh-CN';

export function getLanguage(): Language {
  return language;
}

function applyLanguage(value: Language) {
  language = value;
  document.documentElement.lang = value;
}

export async function loadLanguage() {
  const stored = await window.gitatlas?.readLanguage?.().catch(() => null);
  let local: string | null = null;
  try {
    local = localStorage.getItem(STORAGE_KEY);
  } catch {
    // The switch also works when browser storage is unavailable.
  }
  applyLanguage((stored ?? local) === 'en' ? 'en' : 'zh-CN');
}

export function saveLanguage(value: Language) {
  applyLanguage(value);
  try {
    localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // Electron persists the preference independently of the window's origin.
  }
  void window.gitatlas?.writeLanguage?.(value).catch(() => undefined);
}

export function translate(language: Language, source: string, ...values: unknown[]): string {
  const template = language === 'en' && Object.hasOwn(english, source) ? english[source]! : source;
  return template.replace(/\{(\d+)\}/g, (token, index: string) => {
    const value = values[Number(index)];
    return value === undefined ? token : String(value);
  });
}

export function useTranslation() {
  const language = useContext(LanguageContext);
  return { language, t: (source: string, ...values: unknown[]) => translate(language, source, ...values) };
}

const messagePatterns = Object.keys(english).filter((key) => /\{\d+\}/.test(key)).map((key) => {
  const indices = [...key.matchAll(/\{(\d+)\}/g)].map((match) => Number(match[1]));
  const parts = key.split(/\{\d+\}/g).map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return { key, indices, pattern: new RegExp(`^${parts.join('([\\s\\S]*?)')}$`) };
});

export function translateMessage(source: string, language = getLanguage()): string {
  if (language !== 'en' || !/\p{Script=Han}/u.test(source)) return source;
  if (Object.hasOwn(english, source)) return translate(language, source);
  for (const { key, indices, pattern } of messagePatterns) {
    const match = pattern.exec(source);
    if (!match) continue;
    const values: string[] = [];
    for (const [index, slot] of indices.entries()) values[slot] = match[index + 1] ?? '';
    return translate(language, key, ...values);
  }
  return source;
}
