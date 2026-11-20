import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { isRecord } from '../../src/core/guards.js';
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

function jsonObject(raw: string): Record<string, unknown> {
  const value: unknown = JSON.parse(raw);
  if (!isRecord(value)) throw new Error('expected a JSON object');
  return value;
}

function issueCount(raw: string): number {
  const issues = jsonObject(raw).issues;
  if (!Array.isArray(issues)) throw new Error('expected issues array');
  return issues.length;
}

async function seed(
  anchor: TempDir,
  id: string,
  overrides: Record<string, unknown> = {},
  body = '',
): Promise<string> {
  const file = path.join(anchor.root, 'openissue', 'issues', `${id}.md`);
  const content = issueFixture(
    {
      id,
      title: '生命周期需求',
      status: 'open',
      product: 'demo',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
      author: '测试作者',
      source: 'cli',
      blocked_by: [],
      proposals: [],
      ...overrides,
    },
    body,
  );
  await writeFile(file, content, 'utf8');
  return content;
}

async function readFrontmatter(anchor: TempDir, id: string): Promise<Record<string, unknown>> {
  const raw = await readFile(
    path.join(anchor.root, 'openissue', 'issues', `${id}.md`),
    'utf8',
  );
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw);
  expect(match).not.toBeNull();
  return YAML.parse(match![1]!) as Record<string, unknown>;
}

describe('issue lifecycle', () => {
  it('creates issues open, closes with a reason, and hides closed items by default', async () => {
    const anchor = await createAnchor({ id: 'demo' });
    cleanup.push(anchor);
    const created = runCli(['create', '生命周期需求', '--json'], {
      cwd: anchor.root,
      env: env(anchor),
    });
    expect(created.status, created.stderr).toBe(0);
    const id = String(jsonObject(created.stdout).id);

    let fm = await readFrontmatter(anchor, id);
    expect(fm.status).toBe('open');

    const defaultList = runCli(['list', '--json'], { cwd: anchor.root, env: env(anchor) });
    expect(defaultList.status, defaultList.stderr).toBe(0);
    expect(issueCount(defaultList.stdout)).toBe(1);

    const closed = runCli(['close', id, '--reason', 'completed'], {
      cwd: anchor.root,
      env: env(anchor),
    });
    expect(closed.status, closed.stderr).toBe(0);
    fm = await readFrontmatter(anchor, id);
    expect(fm.status).toBe('closed');
    expect(fm.close).toMatchObject({ reason: 'completed' });

    const afterClose = runCli(['list', '--json'], { cwd: anchor.root, env: env(anchor) });
    expect(issueCount(afterClose.stdout)).toBe(0);

    const closedList = runCli(['list', '--status', 'closed'], {
      cwd: anchor.root,
      env: env(anchor),
    });
    expect(closedList.status, closedList.stderr).toBe(0);
    expect(closedList.stdout).toContain('关闭 · 已完成');
  });

  it('requires a reason, and a note for wontdo', async () => {
    const anchor = await createAnchor({ id: 'demo' });
    cleanup.push(anchor);
    await seed(anchor, 'OI-20260101-AAAA');

    const missing = runCli(['close', 'OI-20260101-AAAA'], {
      cwd: anchor.root,
      env: env(anchor),
    });
    expect(missing.status).not.toBe(0);
    expect(missing.stderr).toContain('关闭原因');
    expect((await readFrontmatter(anchor, 'OI-20260101-AAAA')).status).toBe('open');

    const blank = runCli(
      ['close', 'OI-20260101-AAAA', '--reason', 'wontdo', '--note', '   '],
      { cwd: anchor.root, env: env(anchor) },
    );
    expect(blank.status).not.toBe(0);
    expect(blank.stderr).toContain('原因必填');
    expect((await readFrontmatter(anchor, 'OI-20260101-AAAA')).status).toBe('open');

    const wontdo = runCli(
      ['close', 'OI-20260101-AAAA', '--reason', 'wontdo', '--note', '方向已调整'],
      { cwd: anchor.root, env: env(anchor) },
    );
    expect(wontdo.status, wontdo.stderr).toBe(0);
    expect((await readFrontmatter(anchor, 'OI-20260101-AAAA')).close).toMatchObject({
      reason: 'wontdo',
      note: '方向已调整',
    });
  });

  it('reopens while retaining the close reason and never exposes delete', async () => {
    const anchor = await createAnchor({ id: 'demo' });
    cleanup.push(anchor);
    await seed(anchor, 'OI-20260101-BBBB', {
      status: 'closed',
      close: { reason: 'wontdo', note: '暂不做', closed_at: '2026-01-02T00:00:00.000Z' },
    });

    const reopened = runCli(['reopen', 'OI-20260101-BBBB'], {
      cwd: anchor.root,
      env: env(anchor),
    });
    expect(reopened.status, reopened.stderr).toBe(0);
    const fm = await readFrontmatter(anchor, 'OI-20260101-BBBB');
    expect(fm.status).toBe('open');
    expect(fm.close).toMatchObject({ reason: 'wontdo', note: '暂不做' });

    const listed = runCli(['list', '--json'], { cwd: anchor.root, env: env(anchor) });
    expect(issueCount(listed.stdout)).toBe(1);

    const removed = runCli(['delete', 'OI-20260101-BBBB'], {
      cwd: anchor.root,
      env: env(anchor),
    });
    expect(removed.status).not.toBe(0);
    expect(removed.stderr).toMatch(/unknown command|未知命令/);
    expect(await readdir(path.join(anchor.root, 'openissue', 'issues'))).toHaveLength(1);
  });

  it('does not modify a linked proposal when closing the issue', async () => {
    const anchor = await createAnchor({ id: 'demo', openspec: true });
    cleanup.push(anchor);
    const proposalFile = path.join(anchor.root, 'openspec', 'changes', 'linked-change', 'proposal.md');
    await mkdir(path.dirname(proposalFile), { recursive: true });
    await writeFile(proposalFile, '# Linked\n\n不要修改我。\n', 'utf8');
    const before = await readFile(proposalFile, 'utf8');
    await seed(anchor, 'OI-20260101-CCCC', {
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
      ['close', 'OI-20260101-CCCC', '--reason', 'completed'],
      { cwd: anchor.root, env: env(anchor) },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('提案不会因此取消或改变');
    expect(await readFile(proposalFile, 'utf8')).toBe(before);
    expect((await readFrontmatter(anchor, 'OI-20260101-CCCC')).status).toBe('closed');
  });
});
