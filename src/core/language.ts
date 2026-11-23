export type Language = 'zh' | 'en';
export type LanguageSource = 'flag' | 'workspace' | 'last-explicit' | 'system';

export interface LanguageSelection {
  language: Language;
  source: LanguageSource;
}

export interface ResolveLanguageInput {
  explicit?: Language | undefined;
  workspace?: Language | undefined;
  lastExplicit?: Language | undefined;
  systemLocale?: string | undefined;
}

export function localeToLanguage(locale: string | undefined): Language {
  if (locale && locale.trim().toLowerCase().startsWith('zh')) return 'zh';
  return 'en';
}

export function detectSystemLanguage(
  env: NodeJS.ProcessEnv = process.env,
): Language {
  const configured = env.LC_ALL || env.LC_MESSAGES || env.LANG;
  if (configured && configured.trim()) return localeToLanguage(configured);
  return localeToLanguage(Intl.DateTimeFormat().resolvedOptions().locale);
}

export function normalizeLanguage(value: unknown): Language | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  return normalized === 'zh' || normalized === 'en' ? normalized : undefined;
}

export function resolveLanguage(input: ResolveLanguageInput): LanguageSelection {
  if (input.explicit) return { language: input.explicit, source: 'flag' };
  if (input.workspace) return { language: input.workspace, source: 'workspace' };
  if (input.lastExplicit) {
    return { language: input.lastExplicit, source: 'last-explicit' };
  }
  return {
    language: localeToLanguage(input.systemLocale ?? detectSystemLanguage()),
    source: 'system',
  };
}
