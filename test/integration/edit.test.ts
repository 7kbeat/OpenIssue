import { afterEach, describe, expect, it } from 'vitest';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { createAnchor, issueFixture, runCli, type TempDir } from '../helpers/fixtures.js';

const cleanup: TempDir[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((item) => item.cleanup()));
});

function env(anchor: TempDir): NodeJS.ProcessEnv {
  return {
    OPENISSUE_HOME: path.join(anchor.root, '.home'),
    OPENISSUE_AUTHOR: '测试作者',
  };
}

async function readStored(anchor: TempDir, id: string): Promise<{
  raw: string;
  frontmatter: Record<string, unknown>;
  body: string;
}> {
  const file = path.join(anchor.root, 'openissue', 'issues', `${id}.md`);
  const raw = await readFile(file, 'utf8');
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  expect(match).not.toBeNull();
  return {
    raw,
    frontmatter: YAML.parse(match![1]!) as Record<string, unknown>,
    body: match![2] ?? '',
  };
}

async function seed(anchor: TempDir, id: string, overrides: Record<string, unknown> = {}, body = ''): Promise<void> {
  const fields = {
    id,
    title: '原始标题',
    status: 'open',
    product: 'demo',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    author: '测试作者',
    source: 'cli',
    blocked_by: [],
    proposals: [],
    ...overrides,
  };
  await writeFile(
    path.join(anchor.root, 'openissue', 'issues', `${id}.md`),
    issueFixture(fields, body),
    'utf8',
  );
}

describe('capture validation and edit', () => {
  it('rejects an empty or whitespace-only title without creating a record', async () => {
    const anchor = await createAnchor({ id: 'demo' });
    cleanup.push(anchor);

    const empty = runCli(['create', ''], { cwd: anchor.root, env: env(anchor) });
    expect(empty.status).not.toBe(0);
    expect(empty.stderr).toContain('标题必填');

    const blank = runCli(['create', '   '], { cwd: anchor.root, env: env(anchor) });
    expect(blank.status).not.toBe(0);
    expect(blank.stderr).toContain('标题必填');

    expect(await readdir(path.join(anchor.root, 'openissue', 'issues'))).toHaveLength(0);
  });

  it('adds and clears an optional description without changing status', async () => {
    const anchor = await createAnchor({ id: 'demo' });
    cleanup.push(anchor);
    await seed(anchor, 'OI-20260101-AAAA');

    const added = runCli(
      ['edit', 'OI-20260101-AAAA', '--description', '补充描述'],
      { cwd: anchor.root, env: env(anchor) },
    );
    expect(added.status, added.stderr).toBe(0);
    let stored = await readStored(anchor, 'OI-20260101-AAAA');
    expect(stored.body.trim()).toBe('补充描述');
    expect(stored.frontmatter.status).toBe('open');

    const cleared = runCli(
      ['edit', 'OI-20260101-AAAA', '--description', ''],
      { cwd: anchor.root, env: env(anchor) },
    );
    expect(cleared.status, cleared.stderr).toBe(0);
    stored = await readStored(anchor, 'OI-20260101-AAAA');
    expect(stored.body.trim()).toBe('');
    expect(stored.frontmatter.status).toBe('open');
    expect(stored.frontmatter.title).toBe('原始标题');
  });

  it('updates a title while preserving status and proposal links', async () => {
    const anchor = await createAnchor({ id: 'demo' });
    cleanup.push(anchor);
    await seed(anchor, 'OI-20260101-BBBB', {
      status: 'closed',
      close: { reason: 'wontdo', note: '暂不做', closed_at: '2026-01-02T00:00:00.000Z' },
      proposals: [
        {
          id: 'linked-change',
          path: 'openspec/changes/linked-change',
          created_at: '2026-01-01T00:00:00.000Z',
          snapshot_hash: 'hash',
        },
      ],
    });

    const result = runCli(
      ['edit', 'OI-20260101-BBBB', '--title', '新标题'],
      { cwd: anchor.root, env: env(anchor) },
    );
    expect(result.status, result.stderr).toBe(0);
    const stored = await readStored(anchor, 'OI-20260101-BBBB');
    expect(stored.frontmatter.title).toBe('新标题');
    expect(stored.frontmatter.status).toBe('closed');
    expect(stored.frontmatter.close).toMatchObject({ reason: 'wontdo', note: '暂不做' });
    expect(stored.frontmatter.proposals).toHaveLength(1);
  });

  it('rejects a blank title edit and leaves the record unchanged', async () => {
    const anchor = await createAnchor({ id: 'demo' });
    cleanup.push(anchor);
    await seed(anchor, 'OI-20260101-CCCC');
    const before = (await readStored(anchor, 'OI-20260101-CCCC')).raw;

    const result = runCli(
      ['edit', 'OI-20260101-CCCC', '--title', '   '],
      { cwd: anchor.root, env: env(anchor) },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('标题必填');
    expect((await readStored(anchor, 'OI-20260101-CCCC')).raw).toBe(before);
  });
});
