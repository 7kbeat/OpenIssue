import { afterEach, describe, expect, it } from 'vitest';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { createAnchor, issueFixture, runCli, type TempDir } from '../helpers/fixtures.js';

const cleanup: TempDir[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((item) => item.cleanup()));
});

function cliEnv(anchor: TempDir): NodeJS.ProcessEnv {
  return {
    OPENISSUE_HOME: path.join(anchor.root, '.openissue-home'),
    OPENISSUE_AUTHOR: '测试作者',
  };
}

async function readOnlyIssue(anchor: TempDir): Promise<{
  file: string;
  frontmatter: Record<string, unknown>;
  body: string;
}> {
  const dir = path.join(anchor.root, 'openissue', 'issues');
  const files = (await readdir(dir)).filter((name) => name.endsWith('.md'));
  expect(files).toHaveLength(1);
  const file = path.join(dir, files[0]!);
  const raw = await readFile(file, 'utf8');
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  expect(match).not.toBeNull();
  return {
    file,
    frontmatter: YAML.parse(match![1]!) as Record<string, unknown>,
    body: match![2] ?? '',
  };
}

describe('capture', () => {
  it('creates an open issue from a title alone and records context', async () => {
    const anchor = await createAnchor({ id: 'demo' });
    cleanup.push(anchor);

    const result = runCli(['create', '把需求收件箱跑通', '--json'], {
      cwd: anchor.root,
      env: cliEnv(anchor),
    });

    expect(result.status, result.stderr).toBe(0);
    const output = JSON.parse(result.stdout) as { id: string; path: string };
    expect(output.id).toMatch(/^OI-\d{8}-[A-Z0-9]{4}$/);

    const stored = await readOnlyIssue(anchor);
    expect(stored.frontmatter.id).toBe(output.id);
    expect(stored.frontmatter.title).toBe('把需求收件箱跑通');
    expect(stored.frontmatter.status).toBe('open');
    expect(stored.frontmatter.product).toBe('demo');
    expect(stored.frontmatter.source).toBe('cli');
    expect(stored.frontmatter.author).toBe('测试作者');
    expect(String(stored.frontmatter.created_at)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(stored.body.trim()).toBe('');

    const listed = runCli(['list', '--json'], { cwd: anchor.root, env: cliEnv(anchor) });
    expect(listed.status, listed.stderr).toBe(0);
    const list = JSON.parse(listed.stdout) as { issues: Array<Record<string, unknown>> };
    expect(list.issues).toHaveLength(1);
    expect(list.issues[0]!.title).toBe('把需求收件箱跑通');
  });

  it('stores an optional description without requiring it', async () => {
    const anchor = await createAnchor({ id: 'demo' });
    cleanup.push(anchor);

    const result = runCli(
      ['create', '带描述的需求', '--description', '补充说明', '--json'],
      { cwd: anchor.root, env: cliEnv(anchor) },
    );
    expect(result.status, result.stderr).toBe(0);
    const stored = await readOnlyIssue(anchor);
    expect(stored.body.trim()).toBe('补充说明');
  });

  it('does not mutate an existing issue when listing', async () => {
    const anchor = await createAnchor({ id: 'demo' });
    cleanup.push(anchor);
    const file = path.join(anchor.root, 'openissue', 'issues', 'OI-20260101-AAAA.md');
    const raw = issueFixture(
      {
        id: 'OI-20260101-AAAA',
        title: '既有需求',
        status: 'open',
        product: 'demo',
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
        author: '测试作者',
        source: 'cli',
      },
      '原有描述',
    );
    await writeFile(file, raw, 'utf8');
    const result = runCli(['list', '--json'], { cwd: anchor.root, env: cliEnv(anchor) });
    expect(result.status, result.stderr).toBe(0);
    expect(await readFile(file, 'utf8')).toBe(raw);
  });
});
