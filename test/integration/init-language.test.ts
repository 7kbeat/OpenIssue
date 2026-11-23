import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import YAML from 'yaml';
import { languageWorkspaceKey } from '../../src/storage/preferences.js';
import {
  createOpenspecSkeleton,
  createTempDir,
  runCli,
  runOpenspec,
  type TempDir,
} from '../helpers/fixtures.js';

const cleanup: TempDir[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((item) => item.cleanup()));
});

async function workspaceWithAnchor(): Promise<{ workspace: TempDir; home: TempDir }> {
  const workspace = await createTempDir('openissue-lang-ws-');
  const home = await createTempDir('openissue-lang-home-');
  cleanup.push(workspace, home);
  await mkdir(path.join(workspace.root, 'spec'), { recursive: true });
  await createOpenspecSkeleton(path.join(workspace.root, 'spec'));
  return { workspace, home };
}

function env(home: TempDir, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    OPENISSUE_HOME: home.root,
    OPENISSUE_AUTHOR: '测试作者',
    ...extra,
  };
}

function init(
  workspace: TempDir,
  home: TempDir,
  args: string[],
  extraEnv: NodeJS.ProcessEnv = {},
) {
  return runCli(['init', ...args], {
    cwd: workspace.root,
    env: env(home, extraEnv),
  });
}

function parse<T>(result: { stdout: string }): T {
  const start = result.stdout.indexOf('{');
  return JSON.parse(result.stdout.slice(start)) as T;
}

async function readPrefs(home: TempDir): Promise<{
  language?: { last_explicit?: string; workspaces?: Record<string, string> };
}> {
  return YAML.parse(await readFile(path.join(home.root, 'preferences.yaml'), 'utf8')) as {
    language?: { last_explicit?: string; workspaces?: Record<string, string> };
  };
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

const base = ['--anchor', 'spec', '--yes', '--skills', 'none', '--no-members', '--json'];

describe('init language selection', () => {
  it('persists explicit English and reuses it for the same workspace', async () => {
    const { workspace, home } = await workspaceWithAnchor();

    const first = init(workspace, home, [...base, '--en']);
    expect(first.status, first.stderr).toBe(0);
    const firstReport = parse<{ language: string; language_source: string }>(first);
    expect(firstReport.language).toBe('en');
    expect(firstReport.language_source).toBe('flag');

    const prefs = await readPrefs(home);
    expect(prefs.language?.last_explicit).toBe('en');
    expect(prefs.language?.workspaces?.[languageWorkspaceKey(workspace.root)]).toBe('en');

    const second = init(workspace, home, ['--skills', 'none', '--json']);
    expect(second.status, second.stderr).toBe(0);
    const secondReport = parse<{ language: string; language_source: string }>(second);
    expect(secondReport.language).toBe('en');
    expect(secondReport.language_source).toBe('workspace');
  });

  it('keeps workspace languages independent', async () => {
    const first = await workspaceWithAnchor();
    const second = await workspaceWithAnchor();

    expect(init(first.workspace, first.home, [...base, '--en']).status).toBe(0);
    expect(init(second.workspace, first.home, [...base, '--zh']).status).toBe(0);

    const again = parse<{ language: string; language_source: string }>(
      init(first.workspace, first.home, ['--skills', 'none', '--json']),
    );
    expect(again.language).toBe('en');
    expect(again.language_source).toBe('workspace');
  });

  it('inherits the last explicit language in a new workspace', async () => {
    const first = await workspaceWithAnchor();
    expect(init(first.workspace, first.home, [...base, '--en']).status).toBe(0);

    const next = await createTempDir('openissue-lang-new-');
    cleanup.push(next);
    const result = runCli(
      [
        'init',
        '--new',
        '--name',
        'Demo',
        '--yes',
        '--skills',
        'none',
        '--no-openspec',
        '--json',
      ],
      { cwd: next.root, env: env(first.home) },
    );
    expect(result.status, result.stderr).toBe(0);
    const report = parse<{ language: string; language_source: string }>(result);
    expect(report.language).toBe('en');
    expect(report.language_source).toBe('last-explicit');

    const prefs = await readPrefs(first.home);
    expect(prefs.language?.workspaces?.[languageWorkspaceKey(next.root)]).toBe('en');
  });

  it('uses LANG for the first-run default', async () => {
    const { workspace, home } = await workspaceWithAnchor();
    const zh = init(workspace, home, [...base], { LANG: 'zh_CN.UTF-8', LC_ALL: '' });
    expect(zh.status, zh.stderr).toBe(0);
    expect(parse<{ language: string; language_source: string }>(zh)).toMatchObject({
      language: 'zh',
      language_source: 'system',
    });

    const fresh = await workspaceWithAnchor();
    const en = init(fresh.workspace, fresh.home, [...base], {
      LANG: 'fr_FR.UTF-8',
      LC_ALL: '',
    });
    expect(en.status, en.stderr).toBe(0);
    expect(parse<{ language: string; language_source: string }>(en)).toMatchObject({
      language: 'en',
      language_source: 'system',
    });
  });

  it('rejects conflicting language flags without writing preferences', async () => {
    const { workspace, home } = await workspaceWithAnchor();
    const result = init(workspace, home, [...base, '--zh', '--en']);
    expect(result.status).not.toBe(0);
    const report = parse<{ status: string; error: { code: string; message: string } }>(result);
    expect(report.status).toBe('failed');
    expect(report.error.code).toBe('LANGUAGE_CONFLICT');
    expect(report.error.message).toMatch(/不能同时|Cannot use/);
    expect(await exists(path.join(home.root, 'preferences.yaml'))).toBe(false);
  });

  it('does not mutate an existing preference when language flags conflict', async () => {
    const { workspace, home } = await workspaceWithAnchor();
    expect(init(workspace, home, [...base, '--en']).status).toBe(0);
    const conflict = init(workspace, home, [...base, '--zh', '--en']);
    expect(conflict.status).not.toBe(0);
    const prefs = await readPrefs(home);
    expect(prefs.language?.last_explicit).toBe('en');
    expect(prefs.language?.workspaces?.[languageWorkspaceKey(workspace.root)]).toBe('en');
  });

  it('passes the selected language to a new OpenSpec project', async () => {
    const workspace = await createTempDir('openissue-lang-os-');
    const home = await createTempDir('openissue-lang-home-');
    cleanup.push(workspace, home);
    const result = runCli(
      ['init', '--new', '--name', 'Demo', '--yes', '--skills', 'none', '--en', '--json'],
      { cwd: workspace.root, env: env(home) },
    );
    expect(result.status, result.stderr).toBe(0);
    const config = await readFile(
      path.join(workspace.root, 'demo-spec', 'openspec', 'config.yaml'),
      'utf8',
    );
    expect(config).toContain('Language: en');
    const validated = runOpenspec(path.join(workspace.root, 'demo-spec'), [
      'validate',
      '--all',
      '--strict',
    ]);
    expect(validated.status, validated.stderr).toBe(0);
  });

  it('does not rewrite existing OpenSpec data when the language changes', async () => {
    const { workspace, home } = await workspaceWithAnchor();
    const configPath = path.join(workspace.root, 'spec', 'openspec', 'config.yaml');
    const before = 'schema: spec-driven\n\ncontext: |\n  Language: zh-CN\n';
    await writeFile(configPath, before, 'utf8');

    const result = init(workspace, home, [...base, '--en']);
    expect(result.status, result.stderr).toBe(0);
    expect(await readFile(configPath, 'utf8')).toBe(before);
  });

  it('returns an English structured error for an English JSON failure', async () => {
    const workspace = await createTempDir('openissue-lang-empty-');
    const home = await createTempDir('openissue-lang-home-');
    cleanup.push(workspace, home);
    const result = runCli(['init', '--new', '--en', '--json'], {
      cwd: workspace.root,
      env: env(home),
    });
    expect(result.status).not.toBe(0);
    const report = parse<{ error: { code: string; message: string } }>(result);
    expect(report.error.code).toBe('PROJECT_NAME_REQUIRED');
    expect(report.error.message).toContain('English');
  });
});
