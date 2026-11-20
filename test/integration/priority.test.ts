import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { isRecord } from '../../src/core/guards.js';
import { mutateIssue } from '../../src/storage/issue.js';
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
  manual?: 'high' | 'medium' | 'low';
  cache?: Record<string, unknown>;
  title?: string;
  description?: string;
  created?: string;
  blockedBy?: string[];
}

async function seed(anchor: TempDir, id: string, options: SeedOptions = {}): Promise<void> {
  const priority: Record<string, unknown> = {};
  if (options.cache) Object.assign(priority, options.cache);
  if (options.manual) {
    priority.manual_tier = options.manual;
    priority.manual_at = '2026-01-02T00:00:00.000Z';
  }
  await writeFile(
    path.join(anchor.root, 'openissue', 'issues', `${id}.md`),
    issueFixture(
      {
        id,
        title: options.title ?? `需求 ${id}`,
        status: 'open',
        product: 'demo',
        created_at: options.created ?? '2026-01-01T00:00:00.000Z',
        updated_at: options.created ?? '2026-01-01T00:00:00.000Z',
        author: '测试作者',
        source: 'cli',
        blocked_by: options.blockedBy ?? [],
        priority,
      },
      options.description ?? '',
    ),
    'utf8',
  );
}

interface PriorityJson {
  focus: string;
  focus_updated_at: string | null;
  facts: {
    specs: Array<Record<string, unknown>>;
    proposals: Array<Record<string, unknown>>;
    openspec_initialized: boolean;
  };
  groups: Record<string, Array<Record<string, unknown>>>;
  closed: Array<Record<string, unknown>>;
}

function priority(anchor: TempDir): PriorityJson {
  const result = runCli(['priority', '--json'], { cwd: anchor.root, env: env(anchor) });
  expect(result.status, result.stderr).toBe(0);
  const value: unknown = JSON.parse(result.stdout);
  if (!isRecord(value) || !isRecord(value.groups) || !isRecord(value.facts)) {
    throw new Error('invalid priority output');
  }
  const groups: Record<string, Array<Record<string, unknown>>> = {};
  for (const [key, items] of Object.entries(value.groups)) {
    if (!Array.isArray(items)) throw new Error('invalid group');
    groups[key] = items.filter(isRecord);
  }
  return {
    focus: typeof value.focus === 'string' ? value.focus : '',
    focus_updated_at: typeof value.focus_updated_at === 'string' ? value.focus_updated_at : null,
    facts: {
      specs: Array.isArray(value.facts.specs) ? value.facts.specs.filter(isRecord) : [],
      proposals: Array.isArray(value.facts.proposals)
        ? value.facts.proposals.filter(isRecord)
        : [],
      openspec_initialized: value.facts.openspec_initialized === true,
    },
    groups,
    closed: Array.isArray(value.closed) ? value.closed.filter(isRecord) : [],
  };
}

function findItem(output: PriorityJson, id: string): Record<string, unknown> {
  for (const items of Object.values(output.groups)) {
    const item = items.find((candidate) => candidate.id === id);
    if (item) return item;
  }
  throw new Error(`item ${id} not found`);
}

function groupOf(output: PriorityJson, id: string): string {
  for (const [group, items] of Object.entries(output.groups)) {
    if (items.some((candidate) => candidate.id === id)) return group;
  }
  throw new Error(`group for ${id} not found`);
}

describe('priority context', () => {
  it('sets, exposes, and clears the current focus from the command line', async () => {
    const anchor = await createAnchor({ id: 'demo' });
    cleanup.push(anchor);
    const set = runCli(['focus', '先跑通需求收件箱', '--json'], {
      cwd: anchor.root,
      env: env(anchor),
    });
    expect(set.status, set.stderr).toBe(0);
    const setJson: unknown = JSON.parse(set.stdout);
    if (!isRecord(setJson)) throw new Error('invalid focus output');
    expect(setJson.focus).toBe('先跑通需求收件箱');
    expect(typeof setJson.focus_updated_at).toBe('string');

    const output = priority(anchor);
    expect(output.focus).toBe('先跑通需求收件箱');

    const cleared = runCli(['focus', '--clear', '--json'], {
      cwd: anchor.root,
      env: env(anchor),
    });
    expect(cleared.status, cleared.stderr).toBe(0);
    expect(priority(anchor).focus).toBe('');
    const product = YAML.parse(
      await readFile(path.join(anchor.root, 'openissue', 'product.yaml'), 'utf8'),
    ) as { focus: string };
    expect(product.focus).toBe('');
  });

  it('reads specs, active changes, archived changes, and task progress', async () => {
    const anchor = await createAnchor({ id: 'demo', openspec: true });
    cleanup.push(anchor);
    await mkdir(path.join(anchor.root, 'openspec', 'specs', 'billing'), { recursive: true });
    await writeFile(
      path.join(anchor.root, 'openspec', 'specs', 'billing', 'spec.md'),
      '# Billing\n\n## Purpose\n',
      'utf8',
    );
    const active = path.join(anchor.root, 'openspec', 'changes', 'alpha');
    await mkdir(active, { recursive: true });
    await writeFile(path.join(active, 'proposal.md'), '# Alpha Proposal\n', 'utf8');
    await writeFile(path.join(active, 'tasks.md'), '- [x] one\n- [ ] two\n', 'utf8');
    const archived = path.join(anchor.root, 'openspec', 'changes', 'archive', '2026-01-01-beta');
    await mkdir(archived, { recursive: true });
    await writeFile(path.join(archived, 'proposal.md'), '# Beta Proposal\n', 'utf8');
    await writeFile(path.join(archived, 'tasks.md'), '- [x] done\n', 'utf8');

    const output = priority(anchor);
    expect(output.facts.openspec_initialized).toBe(true);
    expect(output.facts.specs.map((item) => item.id)).toContain('billing');
    const alpha = output.facts.proposals.find((item) => item.id === 'alpha');
    expect(alpha).toMatchObject({ tasks_total: 2, tasks_done: 1, archived: false });
    const beta = output.facts.proposals.find((item) => item.id === 'beta');
    expect(beta).toMatchObject({ tasks_total: 1, tasks_done: 1, archived: true });
  });

  it('does not invent facts or treat age as importance', async () => {
    const anchor = await createAnchor({ id: 'demo' });
    cleanup.push(anchor);
    await seed(anchor, 'OI-20200101-OLD1', { created: '2020-01-01T00:00:00.000Z' });
    const output = priority(anchor);
    expect(output.facts.openspec_initialized).toBe(false);
    expect(output.facts.specs).toHaveLength(0);
    expect(output.facts.proposals).toHaveLength(0);
    expect(groupOf(output, 'OI-20200101-OLD1')).toBe('unassessed');
  });
});

describe('priority display and manual control', () => {
  it('groups cached judgments and keeps the suggested order stable', async () => {
    const anchor = await createAnchor({ id: 'demo' });
    cleanup.push(anchor);
    for (const [id, order] of [
      ['OI-20260101-AAAA', 2],
      ['OI-20260101-BBBB', 0],
      ['OI-20260101-CCCC', 1],
    ] as const) {
      await seed(anchor, id, {
        cache: {
          tier: 'high',
          order,
          reason: `当前重点支持 ${id}`,
          basis: ['focus'],
          judged_at: '2026-01-02T00:00:00.000Z',
          input_hash: 'hash',
          source: 'assistant',
        },
      });
    }
    const first = priority(anchor);
    const firstOrder = first.groups.high!.map((item) => item.id);
    expect(firstOrder).toEqual(['OI-20260101-BBBB', 'OI-20260101-CCCC', 'OI-20260101-AAAA']);
    const second = priority(anchor);
    expect(second.groups.high!.map((item) => item.id)).toEqual(firstOrder);
  });

  it('keeps manual tiers over assistant results and restores automatic', async () => {
    const anchor = await createAnchor({ id: 'demo' });
    cleanup.push(anchor);
    await seed(anchor, 'OI-20260101-AAAA', {
      manual: 'high',
      cache: {
        tier: 'low',
        reason: '助手判断为低',
        basis: ['focus'],
        input_hash: 'hash',
        judged_at: '2026-01-02T00:00:00.000Z',
        source: 'assistant',
      },
    });
    await seed(anchor, 'OI-20260101-BBBB', {
      manual: 'low',
      cache: {
        tier: 'high',
        reason: '助手判断为高',
        basis: ['focus'],
        input_hash: 'hash',
        judged_at: '2026-01-02T00:00:00.000Z',
        source: 'assistant',
      },
    });
    let output = priority(anchor);
    expect(groupOf(output, 'OI-20260101-AAAA')).toBe('high');
    expect(findItem(output, 'OI-20260101-AAAA').manual).toBe(true);
    expect(String(findItem(output, 'OI-20260101-AAAA').reason)).toContain('手动设定');
    expect(groupOf(output, 'OI-20260101-BBBB')).toBe('low');

    const restored = runCli(['tier', 'OI-20260101-BBBB', 'auto', '--json'], {
      cwd: anchor.root,
      env: env(anchor),
    });
    expect(restored.status, restored.stderr).toBe(0);
    output = priority(anchor);
    expect(groupOf(output, 'OI-20260101-BBBB')).toBe('high');
    expect(findItem(output, 'OI-20260101-BBBB').manual).toBe(false);
  });

  it('excludes closed issues and reports a failed save without changing the record', async () => {
    const anchor = await createAnchor({ id: 'demo' });
    cleanup.push(anchor);
    await seed(anchor, 'OI-20260101-AAAA', {
      manual: 'high',
      cache: {
        tier: 'high',
        reason: '已完成',
        basis: ['focus'],
        input_hash: 'hash',
        source: 'assistant',
      },
    });
    const closed = runCli(['close', 'OI-20260101-AAAA', '--reason', 'completed'], {
      cwd: anchor.root,
      env: env(anchor),
    });
    expect(closed.status, closed.stderr).toBe(0);
    const output = priority(anchor);
    expect(output.groups.high!.some((item) => item.id === 'OI-20260101-AAAA')).toBe(false);
    expect(output.closed.some((item) => item.id === 'OI-20260101-AAAA')).toBe(true);

    const file = path.join(anchor.root, 'openissue', 'issues', 'OI-20260101-BBBB.md');
    await seed(anchor, 'OI-20260101-BBBB');
    const before = await readFile(file, 'utf8');
    await expect(
      mutateIssue(
        path.join(anchor.root, 'openissue'),
        'demo',
        'OI-20260101-BBBB',
        (issue) => {
          issue.title = '不应写入';
        },
        { expectedUpdatedAt: 'stale-token' },
      ),
    ).rejects.toThrow(/外部修改/);
    expect(await readFile(file, 'utf8')).toBe(before);
  });
});

describe('priority cache', () => {
  it('reuses an unchanged input and marks changed input as stale', async () => {
    const anchor = await createAnchor({ id: 'demo' });
    cleanup.push(anchor);
    await seed(anchor, 'OI-20260101-AAAA');
    const initial = priority(anchor);
    const hash = initial.groups.unassessed![0]!.input_hash;
    expect(typeof hash).toBe('string');
    expect(initial.groups.unassessed![0]!.stale).toBe(false);

    await seed(anchor, 'OI-20260101-AAAA', {
      cache: {
        tier: 'high',
        reason: '当前重点要求先做这条',
        basis: ['focus'],
        input_hash: hash,
        judged_at: '2026-01-02T03:04:05.000Z',
        source: 'assistant',
      },
    });
    let output = priority(anchor);
    expect(groupOf(output, 'OI-20260101-AAAA')).toBe('high');
    expect(findItem(output, 'OI-20260101-AAAA').stale).toBe(false);
    expect(findItem(output, 'OI-20260101-AAAA').judged_at).toBe('2026-01-02T03:04:05.000Z');
    output = priority(anchor);
    expect(findItem(output, 'OI-20260101-AAAA').stale).toBe(false);

    const edited = runCli(
      ['edit', 'OI-20260101-AAAA', '--title', '输入已经变化'],
      { cwd: anchor.root, env: env(anchor) },
    );
    expect(edited.status, edited.stderr).toBe(0);
    output = priority(anchor);
    expect(groupOf(output, 'OI-20260101-AAAA')).toBe('high');
    expect(findItem(output, 'OI-20260101-AAAA').stale).toBe(true);
  });

  it('marks cached judgments stale when the focus changes', async () => {
    const anchor = await createAnchor({ id: 'demo' });
    cleanup.push(anchor);
    await seed(anchor, 'OI-20260101-AAAA');
    const initial = priority(anchor);
    const hash = initial.groups.unassessed![0]!.input_hash;
    await seed(anchor, 'OI-20260101-AAAA', {
      cache: {
        tier: 'medium',
        reason: '旧重点下的判断',
        basis: ['focus'],
        input_hash: hash,
        judged_at: '2026-01-02T00:00:00.000Z',
        source: 'assistant',
      },
    });
    const changed = runCli(['focus', '新的重点'], { cwd: anchor.root, env: env(anchor) });
    expect(changed.status, changed.stderr).toBe(0);
    const output = priority(anchor);
    expect(findItem(output, 'OI-20260101-AAAA').stale).toBe(true);
  });
});
