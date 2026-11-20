import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { startBoard } from '../../src/board/server.js';
import { isRecord } from '../../src/core/guards.js';
import { readProduct } from '../../src/storage/product.js';
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

async function seed(
  anchor: TempDir,
  id: string,
  options: {
    title?: string;
    status?: 'open' | 'closed';
    close?: Record<string, unknown>;
    manual?: 'high' | 'medium' | 'low';
    blockedBy?: string[];
  } = {},
): Promise<void> {
  await writeFile(
    path.join(anchor.root, 'openissue', 'issues', `${id}.md`),
    issueFixture({
      id,
      title: options.title ?? `需求 ${id}`,
      status: options.status ?? 'open',
      product: 'demo',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
      author: '测试作者',
      source: 'cli',
      blocked_by: options.blockedBy ?? [],
      ...(options.close ? { close: options.close } : {}),
      ...(options.manual
        ? { priority: { manual_tier: options.manual, manual_at: '2026-01-02T00:00:00.000Z' } }
        : {}),
    }),
    'utf8',
  );
}

interface EmitRequest {
  focus: string;
  facts: Record<string, unknown>;
  issues: Array<Record<string, unknown>>;
  request_hash: string;
}

function emit(anchor: TempDir): EmitRequest {
  const result = runCli(['prioritize', '--emit'], { cwd: anchor.root, env: env(anchor) });
  expect(result.status, result.stderr).toBe(0);
  const value: unknown = JSON.parse(result.stdout);
  if (!isRecord(value) || !Array.isArray(value.issues) || !isRecord(value.facts)) {
    throw new Error('invalid emit output');
  }
  return {
    focus: typeof value.focus === 'string' ? value.focus : '',
    facts: value.facts,
    issues: value.issues.filter(isRecord),
    request_hash: typeof value.request_hash === 'string' ? value.request_hash : '',
  };
}

function issueFrom(request: EmitRequest, id: string): Record<string, unknown> {
  const item = request.issues.find((candidate) => candidate.id === id);
  if (!item) throw new Error(`issue ${id} missing from request`);
  return item;
}

async function apply(
  anchor: TempDir,
  results: Array<Record<string, unknown>>,
): Promise<{ status: number | null; applied: string[]; errors: string[]; stderr: string }> {
  const file = path.join(anchor.root, 'assistant-response.json');
  await writeFile(file, JSON.stringify({ version: 1, results }, null, 2), 'utf8');
  const result = runCli(['prioritize', '--apply', 'assistant-response.json'], {
    cwd: anchor.root,
    env: env(anchor),
  });
  const value: unknown = result.stdout ? JSON.parse(result.stdout) : {};
  const record = isRecord(value) ? value : {};
  return {
    status: result.status,
    applied: Array.isArray(record.applied)
      ? record.applied.filter((item): item is string => typeof item === 'string')
      : [],
    errors: Array.isArray(record.errors)
      ? record.errors.filter((item): item is string => typeof item === 'string')
      : [],
    stderr: result.stderr,
  };
}

async function priority(anchor: TempDir): Promise<Record<string, Array<Record<string, unknown>>>> {
  const result = runCli(['priority', '--json'], { cwd: anchor.root, env: env(anchor) });
  expect(result.status, result.stderr).toBe(0);
  const value: unknown = JSON.parse(result.stdout);
  if (!isRecord(value) || !isRecord(value.groups)) throw new Error('invalid priority output');
  const groups: Record<string, Array<Record<string, unknown>>> = {};
  for (const [key, items] of Object.entries(value.groups)) {
    if (!Array.isArray(items)) throw new Error('invalid group');
    groups[key] = items.filter(isRecord);
  }
  return groups;
}

async function baseAnchor(): Promise<TempDir> {
  const anchor = await createAnchor({ id: 'demo', openspec: true });
  cleanup.push(anchor);
  await mkdir(path.join(anchor.root, 'openspec', 'specs', 'billing'), { recursive: true });
  await writeFile(
    path.join(anchor.root, 'openspec', 'specs', 'billing', 'spec.md'),
    '# Billing\n',
    'utf8',
  );
  const change = path.join(anchor.root, 'openspec', 'changes', 'alpha');
  await mkdir(change, { recursive: true });
  await writeFile(path.join(change, 'proposal.md'), '# Alpha\n', 'utf8');
  await writeFile(path.join(change, 'tasks.md'), '- [x] one\n- [ ] two\n', 'utf8');
  const focus = runCli(['focus', '先跑通收件箱'], { cwd: anchor.root, env: env(anchor) });
  expect(focus.status, focus.stderr).toBe(0);
  return anchor;
}

describe('assistant protocol', () => {
  it('emits only open issues with focus, facts, hashes, and no credentials', async () => {
    const anchor = await baseAnchor();
    await seed(anchor, 'OI-20260101-AAAA');
    await seed(anchor, 'OI-20260101-BBBB', { manual: 'high' });
    await seed(anchor, 'OI-20260101-CCCC', {
      status: 'closed',
      close: { reason: 'completed', closed_at: '2026-01-03T00:00:00.000Z' },
    });

    const request = emit(anchor);
    expect(request.focus).toBe('先跑通收件箱');
    expect(request.request_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(request.issues.map((item) => item.id).sort()).toEqual([
      'OI-20260101-AAAA',
      'OI-20260101-BBBB',
    ]);
    for (const issue of request.issues) {
      expect(issue.input_hash).toMatch(/^[a-f0-9]{64}$/);
      expect(issue).not.toHaveProperty('author');
      expect(issue).not.toHaveProperty('source');
    }
    const manual = issueFrom(request, 'OI-20260101-BBBB');
    expect(manual.manual_tier).toBe('high');
    expect(JSON.stringify(request)).not.toMatch(/api[_-]?key|模型账号|密钥/i);
  });

  it('applies valid results, preserves manual values, and reuses the cache', async () => {
    const anchor = await baseAnchor();
    await seed(anchor, 'OI-20260101-AAAA');
    await seed(anchor, 'OI-20260101-BBBB', { manual: 'high' });
    const request = emit(anchor);
    const first = issueFrom(request, 'OI-20260101-AAAA');
    const second = issueFrom(request, 'OI-20260101-BBBB');

    const result = await apply(anchor, [
      {
        id: 'OI-20260101-AAAA',
        tier: 'high',
        reason: '当前重点要求先做',
        basis: ['focus', 'spec:billing'],
        order: 0,
        input_hash: first.input_hash,
      },
      {
        id: 'OI-20260101-BBBB',
        tier: 'low',
        reason: '提案任务尚未推进',
        basis: ['proposal:alpha'],
        order: 1,
        input_hash: second.input_hash,
      },
    ]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.errors).toEqual([]);
    expect(result.applied.sort()).toEqual(['OI-20260101-AAAA', 'OI-20260101-BBBB']);

    let groups = await priority(anchor);
    const a = groups.high!.find((item) => item.id === 'OI-20260101-AAAA');
    expect(a).toBeTruthy();
    expect(a!.reason).toBe('当前重点要求先做');
    expect(a!.stale).toBe(false);
    const b = groups.high!.find((item) => item.id === 'OI-20260101-BBBB');
    expect(b).toBeTruthy();
    expect(b!.manual).toBe(true);
    expect(b!.reason).toContain('手动设定');

    const board = await startBoard({
      context: {
        anchorRoot: anchor.root,
        productDir: path.join(anchor.root, 'openissue'),
        product: await readProduct(anchor.root),
      },
      port: 0,
    });
    try {
      const response = await fetch(`${board.url}api/state`);
      const boardState: unknown = await response.json();
      if (!isRecord(boardState) || !isRecord(boardState.groups)) {
        throw new Error('invalid board state');
      }
      const highGroup = boardState.groups.high;
      if (!Array.isArray(highGroup)) throw new Error('invalid high group');
      const highItem = highGroup.find(
        (item) => isRecord(item) && item.id === 'OI-20260101-AAAA',
      );
      if (!isRecord(highItem)) throw new Error('assistant item missing from board');
      expect(highItem.reason).toBe('当前重点要求先做');
      expect(String(highItem.judged_at)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      const html = await fetch(board.url).then((item) => item.text());
      expect(html).not.toMatch(/api[_-]?key|模型账号|密钥/i);
    } finally {
      await board.close();
    }

    const again = emit(anchor);
    expect(issueFrom(again, 'OI-20260101-AAAA').needs_judgment).toBe(false);
    expect(issueFrom(again, 'OI-20260101-BBBB').needs_judgment).toBe(false);
  });

  it('isolates invalid results and rejects closed, forged, and stale entries', async () => {
    const anchor = await baseAnchor();
    await seed(anchor, 'OI-20260101-AAAA');
    await seed(anchor, 'OI-20260101-BBBB', {
      status: 'closed',
      close: { reason: 'completed', closed_at: '2026-01-03T00:00:00.000Z' },
    });
    const request = emit(anchor);
    const valid = issueFrom(request, 'OI-20260101-AAAA');

    const result = await apply(anchor, [
      {
        id: 'OI-20260101-AAAA',
        tier: 'medium',
        reason: '当前重点要求先做',
        basis: ['focus'],
        input_hash: valid.input_hash,
      },
      {
        id: 'OI-20260101-AAAA',
        tier: 'urgent',
        reason: '非法档位',
        basis: ['focus'],
        input_hash: valid.input_hash,
      },
      {
        id: 'OI-20260101-BBBB',
        tier: 'high',
        reason: '关闭项不能写入',
        basis: ['focus'],
        input_hash: 'deadbeef',
      },
      {
        id: 'OI-20260101-AAAA',
        tier: 'high',
        reason: '伪造依据',
        basis: ['proposal:missing'],
        input_hash: valid.input_hash,
      },
      {
        id: 'OI-20260101-AAAA',
        tier: 'high',
        reason: '空依据',
        basis: [],
        input_hash: valid.input_hash,
      },
    ]);
    expect(result.status).not.toBe(0);
    expect(result.applied).toEqual(['OI-20260101-AAAA']);
    expect(result.errors.length).toBeGreaterThanOrEqual(4);
    const groups = await priority(anchor);
    const item = groups.medium!.find((candidate) => candidate.id === 'OI-20260101-AAAA');
    expect(item?.reason).toBe('当前重点要求先做');
  });

  it('rejects a stale input hash and leaves the issue unchanged', async () => {
    const anchor = await baseAnchor();
    await seed(anchor, 'OI-20260101-AAAA');
    const request = emit(anchor);
    const issue = issueFrom(request, 'OI-20260101-AAAA');
    const edited = runCli(
      ['edit', 'OI-20260101-AAAA', '--title', '已修改标题'],
      { cwd: anchor.root, env: env(anchor) },
    );
    expect(edited.status, edited.stderr).toBe(0);

    const result = await apply(anchor, [
      {
        id: 'OI-20260101-AAAA',
        tier: 'high',
        reason: '旧请求',
        basis: ['focus'],
        input_hash: issue.input_hash,
      },
    ]);
    expect(result.status).not.toBe(0);
    expect(result.applied).toEqual([]);
    expect(result.errors.join('\n')).toContain('输入已变化');
    const groups = await priority(anchor);
    expect(groups.unassessed!.some((candidate) => candidate.id === 'OI-20260101-AAAA')).toBe(true);
  });

  it('keeps rules effective and marks the rest unassessed when only part of the results arrive', async () => {
    const anchor = await baseAnchor();
    await seed(anchor, 'OI-20260101-AAAA');
    await seed(anchor, 'OI-20260101-BBBB');
    const request = emit(anchor);
    const first = issueFrom(request, 'OI-20260101-AAAA');
    const result = await apply(anchor, [
      {
        id: 'OI-20260101-AAAA',
        tier: 'high',
        reason: '当前重点要求先做',
        basis: ['focus'],
        input_hash: first.input_hash,
      },
    ]);
    expect(result.status, result.stderr).toBe(0);
    const groups = await priority(anchor);
    expect(groups.high!.some((item) => item.id === 'OI-20260101-AAAA')).toBe(true);
    expect(groups.unassessed!.some((item) => item.id === 'OI-20260101-BBBB')).toBe(true);
  });
});
