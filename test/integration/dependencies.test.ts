import { afterEach, describe, expect, it } from 'vitest';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
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

interface SeedOptions {
  tier?: 'high' | 'medium' | 'low';
  status?: 'open' | 'closed';
  close?: Record<string, unknown>;
  blockedBy?: string[];
  description?: string;
}

async function seed(
  anchor: TempDir,
  id: string,
  options: SeedOptions = {},
): Promise<void> {
  await writeFile(
    path.join(anchor.root, 'openissue', 'issues', `${id}.md`),
    issueFixture(
      {
        id,
        title: `需求 ${id}`,
        status: options.status ?? 'open',
        product: 'demo',
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
        author: '测试作者',
        source: 'cli',
        blocked_by: options.blockedBy ?? [],
        ...(options.close ? { close: options.close } : {}),
        ...(options.tier
          ? { priority: { manual_tier: options.tier, manual_at: '2026-01-01T00:00:00.000Z' } }
          : {}),
      },
      options.description ?? '',
    ),
    'utf8',
  );
}

interface PriorityOutput {
  groups: Record<string, Array<Record<string, unknown>>>;
}

function priority(anchor: TempDir): PriorityOutput {
  const result = runCli(['priority', '--json'], { cwd: anchor.root, env: env(anchor) });
  expect(result.status, result.stderr).toBe(0);
  const value: unknown = JSON.parse(result.stdout);
  if (!isRecord(value) || !isRecord(value.groups)) throw new Error('invalid priority output');
  const groups: Record<string, Array<Record<string, unknown>>> = {};
  for (const [key, items] of Object.entries(value.groups)) {
    if (!Array.isArray(items)) throw new Error('invalid group');
    groups[key] = items.filter(isRecord);
  }
  return { groups };
}

function findItem(output: PriorityOutput, id: string): Record<string, unknown> {
  for (const items of Object.values(output.groups)) {
    const item = items.find((candidate) => candidate.id === id);
    if (item) return item;
  }
  throw new Error(`item ${id} not found`);
}

function groupOf(output: PriorityOutput, id: string): string {
  for (const [group, items] of Object.entries(output.groups)) {
    if (items.some((candidate) => candidate.id === id)) return group;
  }
  throw new Error(`group for ${id} not found`);
}

describe('dependencies', () => {
  it('establishes and removes one explicit blocking relation', async () => {
    const anchor = await createAnchor({ id: 'demo' });
    cleanup.push(anchor);
    await seed(anchor, 'OI-20260101-AAAA', { tier: 'low' });
    await seed(anchor, 'OI-20260101-BBBB', { tier: 'high' });

    const linked = runCli(
      ['depend', 'OI-20260101-AAAA', 'OI-20260101-BBBB', '--json'],
      { cwd: anchor.root, env: env(anchor) },
    );
    expect(linked.status, linked.stderr).toBe(0);
    const linkedJson: unknown = JSON.parse(linked.stdout);
    if (!isRecord(linkedJson) || !Array.isArray(linkedJson.blocked_by)) {
      throw new Error('invalid depend output');
    }
    expect(linkedJson.blocked_by).toContain('OI-20260101-AAAA');

    let output = priority(anchor);
    expect(groupOf(output, 'OI-20260101-AAAA')).toBe('high');
    expect(String(findItem(output, 'OI-20260101-AAAA').reason)).toContain('依赖下限');
    expect(String(findItem(output, 'OI-20260101-AAAA').reason)).toContain('阻塞');
    expect(String(findItem(output, 'OI-20260101-BBBB').reason)).toContain('等待');

    const unlinked = runCli(
      ['undepend', 'OI-20260101-AAAA', 'OI-20260101-BBBB'],
      { cwd: anchor.root, env: env(anchor) },
    );
    expect(unlinked.status, unlinked.stderr).toBe(0);
    output = priority(anchor);
    expect(groupOf(output, 'OI-20260101-AAAA')).toBe('low');
    expect(String(findItem(output, 'OI-20260101-AAAA').reason)).not.toContain('阻塞');
    expect(String(findItem(output, 'OI-20260101-BBBB').reason)).not.toContain('等待');
  });

  it('does not infer dependencies from similar descriptions', async () => {
    const anchor = await createAnchor({ id: 'demo' });
    cleanup.push(anchor);
    await seed(anchor, 'OI-20260101-AAAA', { tier: 'low', description: '登录与账单' });
    await seed(anchor, 'OI-20260101-BBBB', { tier: 'high', description: '登录与账单' });
    const output = priority(anchor);
    expect(String(findItem(output, 'OI-20260101-AAAA').reason)).not.toContain('阻塞');
    expect(String(findItem(output, 'OI-20260101-BBBB').reason)).not.toContain('等待');
  });

  it('applies the floor only to tiered open downstream issues', async () => {
    const anchor = await createAnchor({ id: 'demo' });
    cleanup.push(anchor);
    await seed(anchor, 'OI-20260101-AAAA', { tier: 'low' });
    await seed(anchor, 'OI-20260101-BBBB', { tier: 'high' });
    await seed(anchor, 'OI-20260101-CCCC');
    await seed(anchor, 'OI-20260101-DDDD', {
      status: 'closed',
      close: { reason: 'completed', closed_at: '2026-01-02T00:00:00.000Z' },
    });
    for (const blocked of ['OI-20260101-BBBB', 'OI-20260101-CCCC', 'OI-20260101-DDDD']) {
      const result = runCli(['depend', 'OI-20260101-AAAA', blocked], {
        cwd: anchor.root,
        env: env(anchor),
      });
      expect(result.status, result.stderr).toBe(0);
    }
    const output = priority(anchor);
    expect(groupOf(output, 'OI-20260101-AAAA')).toBe('high');
    expect(groupOf(output, 'OI-20260101-CCCC')).toBe('unassessed');
    expect(findItem(output, 'OI-20260101-AAAA').dependency_floor).toBe(true);
  });

  it('does not lower a high blocker for a low downstream issue', async () => {
    const anchor = await createAnchor({ id: 'demo' });
    cleanup.push(anchor);
    await seed(anchor, 'OI-20260101-AAAA', { tier: 'high' });
    await seed(anchor, 'OI-20260101-BBBB', { tier: 'low' });
    const linked = runCli(
      ['depend', 'OI-20260101-AAAA', 'OI-20260101-BBBB'],
      { cwd: anchor.root, env: env(anchor) },
    );
    expect(linked.status, linked.stderr).toBe(0);
    const output = priority(anchor);
    expect(groupOf(output, 'OI-20260101-AAAA')).toBe('high');
    expect(findItem(output, 'OI-20260101-AAAA').dependency_floor).toBe(false);
  });

  it('propagates a chain and rejects direct and indirect cycles', async () => {
    const anchor = await createAnchor({ id: 'demo' });
    cleanup.push(anchor);
    await seed(anchor, 'OI-20260101-AAAA', { tier: 'low' });
    await seed(anchor, 'OI-20260101-BBBB', { tier: 'low' });
    await seed(anchor, 'OI-20260101-CCCC', { tier: 'high' });
    for (const [blocker, blocked] of [
      ['OI-20260101-AAAA', 'OI-20260101-BBBB'],
      ['OI-20260101-BBBB', 'OI-20260101-CCCC'],
    ]) {
      const result = runCli(['depend', blocker!, blocked!], {
        cwd: anchor.root,
        env: env(anchor),
      });
      expect(result.status, result.stderr).toBe(0);
    }
    let output = priority(anchor);
    expect(groupOf(output, 'OI-20260101-BBBB')).toBe('high');
    expect(groupOf(output, 'OI-20260101-AAAA')).toBe('high');

    const direct = runCli(
      ['depend', 'OI-20260101-BBBB', 'OI-20260101-AAAA'],
      { cwd: anchor.root, env: env(anchor) },
    );
    expect(direct.status).not.toBe(0);
    expect(direct.stderr).toContain('循环');

    const indirect = runCli(
      ['depend', 'OI-20260101-CCCC', 'OI-20260101-AAAA'],
      { cwd: anchor.root, env: env(anchor) },
    );
    expect(indirect.status).not.toBe(0);
    expect(indirect.stderr).toContain('循环');

    const stored = runCli(['show', 'OI-20260101-AAAA', '--json'], {
      cwd: anchor.root,
      env: env(anchor),
    });
    expect(stored.status, stored.stderr).toBe(0);
    const issue: unknown = JSON.parse(stored.stdout);
    if (!isRecord(issue) || !Array.isArray(issue.blocked_by)) throw new Error('invalid issue');
    expect(issue.blocked_by).not.toContain('OI-20260101-CCCC');
  });

  it('unblocks on completed, invalidates on wontdo, and handles missing blockers', async () => {
    const anchor = await createAnchor({ id: 'demo' });
    cleanup.push(anchor);
    await seed(anchor, 'OI-20260101-AAAA', { tier: 'high' });
    await seed(anchor, 'OI-20260101-BBBB', { tier: 'high', blockedBy: ['OI-20260101-AAAA'] });
    await seed(anchor, 'OI-20260101-CCCC', { tier: 'high', blockedBy: ['OI-20260101-MISS'] });

    let output = priority(anchor);
    expect(groupOf(output, 'OI-20260101-BBBB')).toBe('high');
    expect(String(findItem(output, 'OI-20260101-BBBB').reason)).toContain('等待');
    expect(groupOf(output, 'OI-20260101-CCCC')).toBe('unassessed');
    expect(String(findItem(output, 'OI-20260101-CCCC').reason)).toContain('依赖状态不明');

    const completed = runCli(['close', 'OI-20260101-AAAA', '--reason', 'completed'], {
      cwd: anchor.root,
      env: env(anchor),
    });
    expect(completed.status, completed.stderr).toBe(0);
    output = priority(anchor);
    expect(groupOf(output, 'OI-20260101-BBBB')).toBe('high');
    expect(String(findItem(output, 'OI-20260101-BBBB').reason)).not.toContain('等待');
  });

  it('invalidates a downstream issue when its blocker is wontdo, then restores it', async () => {
    const anchor = await createAnchor({ id: 'demo' });
    cleanup.push(anchor);
    await seed(anchor, 'OI-20260101-AAAA', { tier: 'high' });
    await seed(anchor, 'OI-20260101-BBBB', { tier: 'high', blockedBy: ['OI-20260101-AAAA'] });
    const closed = runCli(
      ['close', 'OI-20260101-AAAA', '--reason', 'wontdo', '--note', '方向已调整'],
      { cwd: anchor.root, env: env(anchor) },
    );
    expect(closed.status, closed.stderr).toBe(0);
    let output = priority(anchor);
    expect(groupOf(output, 'OI-20260101-BBBB')).toBe('unassessed');
    expect(String(findItem(output, 'OI-20260101-BBBB').reason)).toContain('前置需求已放弃');
    const manual = findItem(output, 'OI-20260101-BBBB').priority;
    if (!isRecord(manual)) throw new Error('priority missing');
    expect(manual.manual_tier).toBe('high');

    const removed = runCli(
      ['undepend', 'OI-20260101-AAAA', 'OI-20260101-BBBB'],
      { cwd: anchor.root, env: env(anchor) },
    );
    expect(removed.status, removed.stderr).toBe(0);
    output = priority(anchor);
    expect(groupOf(output, 'OI-20260101-BBBB')).toBe('high');
    expect(String(findItem(output, 'OI-20260101-BBBB').reason)).not.toContain('前置需求已放弃');
  });

  it('re-evaluates a chain when the middle node closes or its outgoing edge is removed', async () => {
    const anchor = await createAnchor({ id: 'demo' });
    cleanup.push(anchor);
    await seed(anchor, 'OI-20260101-AAAA', { tier: 'low' });
    await seed(anchor, 'OI-20260101-BBBB', { tier: 'low' });
    await seed(anchor, 'OI-20260101-CCCC', { tier: 'high' });
    for (const [blocker, blocked] of [
      ['OI-20260101-AAAA', 'OI-20260101-BBBB'],
      ['OI-20260101-BBBB', 'OI-20260101-CCCC'],
    ]) {
      const result = runCli(['depend', blocker!, blocked!], {
        cwd: anchor.root,
        env: env(anchor),
      });
      expect(result.status, result.stderr).toBe(0);
    }

    const closed = runCli(['close', 'OI-20260101-BBBB', '--reason', 'completed'], {
      cwd: anchor.root,
      env: env(anchor),
    });
    expect(closed.status, closed.stderr).toBe(0);
    let output = priority(anchor);
    expect(groupOf(output, 'OI-20260101-AAAA')).toBe('low');
    expect(groupOf(output, 'OI-20260101-CCCC')).toBe('high');
    expect(String(findItem(output, 'OI-20260101-CCCC').reason)).not.toContain('等待');

    const reopened = runCli(['reopen', 'OI-20260101-BBBB'], {
      cwd: anchor.root,
      env: env(anchor),
    });
    expect(reopened.status, reopened.stderr).toBe(0);
    const removed = runCli(
      ['undepend', 'OI-20260101-BBBB', 'OI-20260101-CCCC'],
      { cwd: anchor.root, env: env(anchor) },
    );
    expect(removed.status, removed.stderr).toBe(0);
    output = priority(anchor);
    expect(groupOf(output, 'OI-20260101-BBBB')).toBe('low');
    expect(groupOf(output, 'OI-20260101-AAAA')).toBe('low');
    expect(groupOf(output, 'OI-20260101-CCCC')).toBe('high');
  });

  it('replaces an abandoned blocker with a new open prerequisite', async () => {
    const anchor = await createAnchor({ id: 'demo' });
    cleanup.push(anchor);
    await seed(anchor, 'OI-20260101-AAAA', {
      status: 'closed',
      close: { reason: 'wontdo', note: '放弃', closed_at: '2026-01-02T00:00:00.000Z' },
    });
    await seed(anchor, 'OI-20260101-BBBB', { tier: 'high', blockedBy: ['OI-20260101-AAAA'] });
    await seed(anchor, 'OI-20260101-CCCC', { tier: 'low' });

    const remove = runCli(
      ['undepend', 'OI-20260101-AAAA', 'OI-20260101-BBBB'],
      { cwd: anchor.root, env: env(anchor) },
    );
    expect(remove.status, remove.stderr).toBe(0);
    const replace = runCli(
      ['depend', 'OI-20260101-CCCC', 'OI-20260101-BBBB'],
      { cwd: anchor.root, env: env(anchor) },
    );
    expect(replace.status, replace.stderr).toBe(0);

    const output = priority(anchor);
    expect(groupOf(output, 'OI-20260101-CCCC')).toBe('high');
    expect(String(findItem(output, 'OI-20260101-BBBB').reason)).toContain('等待');
    expect(String(findItem(output, 'OI-20260101-BBBB').reason)).not.toContain('前置需求已放弃');
  });
});
