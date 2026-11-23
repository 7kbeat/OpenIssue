import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  detectSystemLanguage,
  localeToLanguage,
  normalizeLanguage,
  resolveLanguage,
} from '../../src/core/language.js';
import {
  languageWorkspaceKey,
  loadLanguageSelection,
  readLanguagePreferences,
  saveExplicitLanguage,
  writeLanguagePreferences,
} from '../../src/storage/preferences.js';
import { createTempDir, type TempDir } from '../helpers/fixtures.js';

const cleanup: TempDir[] = [];

afterEach(async () => {
  delete process.env.OPENISSUE_HOME;
  await Promise.all(cleanup.splice(0).map((item) => item.cleanup()));
});

describe('language resolution', () => {
  it('maps zh locales to Chinese and everything else to English', () => {
    expect(localeToLanguage('zh-CN')).toBe('zh');
    expect(localeToLanguage('zh-TW')).toBe('zh');
    expect(localeToLanguage('zh-Hans')).toBe('zh');
    expect(localeToLanguage('en-US')).toBe('en');
    expect(localeToLanguage('fr-FR')).toBe('en');
    expect(localeToLanguage('')).toBe('en');
    expect(localeToLanguage(undefined)).toBe('en');
  });

  it('uses LANG/LC_ALL before the runtime locale', () => {
    expect(detectSystemLanguage({ LC_ALL: 'zh_CN.UTF-8' })).toBe('zh');
    expect(detectSystemLanguage({ LANG: 'en_US.UTF-8' })).toBe('en');
    expect(detectSystemLanguage({ LC_ALL: 'fr_FR.UTF-8' })).toBe('en');
  });

  it('normalizes only supported values', () => {
    expect(normalizeLanguage('zh')).toBe('zh');
    expect(normalizeLanguage('EN')).toBe('en');
    expect(normalizeLanguage('zh-CN')).toBeUndefined();
    expect(normalizeLanguage(undefined)).toBeUndefined();
  });

  it('resolves explicit, workspace, last explicit, then system', () => {
    expect(
      resolveLanguage({
        explicit: 'en',
        workspace: 'zh',
        lastExplicit: 'zh',
        systemLocale: 'zh-CN',
      }),
    ).toEqual({ language: 'en', source: 'flag' });
    expect(
      resolveLanguage({ workspace: 'zh', lastExplicit: 'en', systemLocale: 'en-US' }),
    ).toEqual({ language: 'zh', source: 'workspace' });
    expect(resolveLanguage({ lastExplicit: 'en', systemLocale: 'zh-CN' })).toEqual({
      language: 'en',
      source: 'last-explicit',
    });
    expect(resolveLanguage({ systemLocale: 'zh-CN' })).toEqual({
      language: 'zh',
      source: 'system',
    });
    expect(resolveLanguage({ systemLocale: 'de-DE' })).toEqual({
      language: 'en',
      source: 'system',
    });
  });
});

describe('language preferences', () => {
  it('persists the workspace preference and the last explicit language', async () => {
    const home = await createTempDir('openissue-home-');
    cleanup.push(home);
    process.env.OPENISSUE_HOME = home.root;

    await saveExplicitLanguage('/tmp/workspace-a', 'en');
    await saveExplicitLanguage('/tmp/workspace-b', 'zh');

    const prefs = await readLanguagePreferences();
    expect(prefs.warning).toBeUndefined();
    expect(prefs.preferences.last_explicit).toBe('zh');
    expect(prefs.preferences.workspaces[languageWorkspaceKey('/tmp/workspace-a')]).toBe('en');
    expect(prefs.preferences.workspaces[languageWorkspaceKey('/tmp/workspace-b')]).toBe('zh');
  });

  it('inherits the last explicit language for a new workspace and records it', async () => {
    const home = await createTempDir('openissue-home-');
    cleanup.push(home);
    process.env.OPENISSUE_HOME = home.root;

    await saveExplicitLanguage('/tmp/workspace-a', 'en');
    const selection = await loadLanguageSelection('/tmp/workspace-new', {
      systemLocale: 'zh-CN',
    });
    expect(selection).toMatchObject({
      language: 'en',
      source: 'last-explicit',
    });

    const prefs = await readLanguagePreferences();
    expect(prefs.preferences.workspaces[languageWorkspaceKey('/tmp/workspace-new')]).toBe('en');
  });

  it('does not let another workspace change an existing preference', async () => {
    const home = await createTempDir('openissue-home-');
    cleanup.push(home);
    process.env.OPENISSUE_HOME = home.root;

    await saveExplicitLanguage('/tmp/workspace-a', 'zh');
    await saveExplicitLanguage('/tmp/workspace-b', 'en');

    const selection = await loadLanguageSelection('/tmp/workspace-a', {
      systemLocale: 'en-US',
    });
    expect(selection).toMatchObject({ language: 'zh', source: 'workspace' });
  });

  it('falls back to the system language when the preference file is corrupt', async () => {
    const home = await createTempDir('openissue-home-');
    cleanup.push(home);
    process.env.OPENISSUE_HOME = home.root;
    await mkdir(home.root, { recursive: true });
    await writeFile(path.join(home.root, 'preferences.yaml'), 'language: [broken\n', 'utf8');

    const selection = await loadLanguageSelection('/tmp/workspace-a', {
      systemLocale: 'en-US',
    });
    expect(selection.language).toBe('en');
    expect(selection.source).toBe('system');
    expect(selection.warning).toContain('偏好');
  });

  it('writes a readable preferences file', async () => {
    const home = await createTempDir('openissue-home-');
    cleanup.push(home);
    process.env.OPENISSUE_HOME = home.root;

    await writeLanguagePreferences({
      last_explicit: 'en',
      workspaces: { '/tmp/x': 'zh' },
    });
    const prefs = await readLanguagePreferences();
    expect(prefs.preferences).toEqual({
      last_explicit: 'en',
      workspaces: { '/tmp/x': 'zh' },
    });
  });
});
