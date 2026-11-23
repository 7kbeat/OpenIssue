import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import {
  normalizeLanguage,
  resolveLanguage,
  type Language,
  type LanguageSelection,
} from '../core/language.js';
import { isRecord } from '../core/guards.js';
import { writeTextAtomic } from './atomic.js';
import { openissueHome } from './registry.js';

export interface LanguagePreferences {
  last_explicit?: Language;
  workspaces: Record<string, Language>;
}

export interface ReadLanguagePreferencesResult {
  preferences: LanguagePreferences;
  warning?: string;
}

export function preferencesPath(): string {
  return path.join(openissueHome(), 'preferences.yaml');
}

export function languageWorkspaceKey(workspaceRoot: string): string {
  const resolved = path.resolve(workspaceRoot);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

export async function readLanguagePreferences(): Promise<ReadLanguagePreferencesResult> {
  let raw: string;
  try {
    raw = await readFile(preferencesPath(), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { preferences: { workspaces: {} } };
    }
    return {
      preferences: { workspaces: {} },
      warning: `语言偏好无法读取：${error instanceof Error ? error.message : String(error)}`,
    };
  }

  let parsed: unknown;
  try {
    parsed = YAML.parse(raw);
  } catch (error) {
    return {
      preferences: { workspaces: {} },
      warning: `语言偏好无法读取：${error instanceof Error ? error.message : String(error)}`,
    };
  }

  if (!isRecord(parsed)) {
    return {
      preferences: { workspaces: {} },
      warning: '语言偏好格式无效，已使用系统默认语言。',
    };
  }

  const language = isRecord(parsed.language) ? parsed.language : {};
  const lastExplicit = normalizeLanguage(language.last_explicit);
  const workspaces: Record<string, Language> = {};
  if (isRecord(language.workspaces)) {
    for (const [key, value] of Object.entries(language.workspaces)) {
      const normalized = normalizeLanguage(value);
      if (normalized && key.trim()) workspaces[key] = normalized;
    }
  }
  return {
    preferences: {
      ...(lastExplicit ? { last_explicit: lastExplicit } : {}),
      workspaces,
    },
  };
}

export async function writeLanguagePreferences(
  preferences: LanguagePreferences,
): Promise<void> {
  await mkdir(openissueHome(), { recursive: true });
  const payload: Record<string, unknown> = {
    language: {
      ...(preferences.last_explicit
        ? { last_explicit: preferences.last_explicit }
        : {}),
      workspaces: preferences.workspaces,
    },
  };
  await writeTextAtomic(
    preferencesPath(),
    YAML.stringify(payload, { lineWidth: 0 }),
  );
}

export async function saveExplicitLanguage(
  workspaceRoot: string,
  language: Language,
): Promise<{ warning?: string }> {
  const { preferences, warning } = await readLanguagePreferences();
  preferences.last_explicit = language;
  preferences.workspaces[languageWorkspaceKey(workspaceRoot)] = language;
  try {
    await writeLanguagePreferences(preferences);
    return warning ? { warning } : {};
  } catch (error) {
    return {
      warning: `语言偏好未能保存：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export async function peekLanguageSelection(
  workspaceRoot: string,
  options: { explicit?: Language; systemLocale?: string } = {},
): Promise<LanguageSelection & { warning?: string }> {
  const { preferences, warning } = await readLanguagePreferences();
  const selection = resolveLanguage({
    explicit: options.explicit,
    workspace: preferences.workspaces[languageWorkspaceKey(workspaceRoot)],
    lastExplicit: preferences.last_explicit,
    systemLocale: options.systemLocale,
  });
  return {
    ...selection,
    ...(warning ? { warning } : {}),
  };
}

export async function loadLanguageSelection(
  workspaceRoot: string,
  options: { explicit?: Language; systemLocale?: string } = {},
): Promise<LanguageSelection & { warning?: string }> {
  const selection = await peekLanguageSelection(workspaceRoot, options);
  const { preferences, warning } = await readLanguagePreferences();
  let nextWarning = warning ?? selection.warning;
  if (selection.source === 'last-explicit') {
    preferences.workspaces[languageWorkspaceKey(workspaceRoot)] = selection.language;
    try {
      await writeLanguagePreferences(preferences);
    } catch (error) {
      nextWarning = `语言偏好未能保存：${error instanceof Error ? error.message : String(error)}`;
    }
  }

  return {
    ...selection,
    ...(nextWarning ? { warning: nextWarning } : {}),
  };
}
