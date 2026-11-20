import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { startBoard, type BoardServer } from '../../src/board/server.js';
import { isRecord } from '../../src/core/guards.js';
import { contentHash } from '../../src/core/hash.js';
import { readProduct } from '../../src/storage/product.js';
import { createAnchor, issueFixture, type TempDir } from '../helpers/fixtures.js';

const cleanup: TempDir[] = [];
const boards: BoardServer[] = [];

afterEach(async () => {
  await Promise.all(boards.splice(0).map((board) => board.close().catch(() => undefined)));
  await Promise.all(cleanup.splice(0).map((item) => item.cleanup()));
});

interface SeedOptions {
  title: string;
  description?: string;
  status?: 'open' | 'closed';
  close?: Record<string, unknown>;
  manual?: 'high' | 'medium' | 'low';
  blockedBy?: string[];
  proposals?: Array<Record<string, unknown>>;
}

async function seed(anchor: TempDir, id: string, options: SeedOptions): Promise<void> {
  await writeFile(
    path.join(anchor.root, 'openissue', 'issues', `${id}.md`),
    issueFixture(
      {
        id,
        title: options.title,
        status: options.status ?? 'open',
        product: 'demo',
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
        author: '测试作者',
        source: 'cli',
        blocked_by: options.blockedBy ?? [],
        proposals: options.proposals ?? [],
        ...(options.close ? { close: options.close } : {}),
        ...(options.manual
          ? { priority: { manual_tier: options.manual, manual_at: '2026-01-02T00:00:00.000Z' } }
          : {}),
      },
      options.description ?? '',
    ),
    'utf8',
  );
}

async function setup(): Promise<{ anchor: TempDir; board: BoardServer }> {
  const anchor = await createAnchor({ id: 'demo', openspec: true });
  cleanup.push(anchor);
  const active = path.join(anchor.root, 'openspec', 'changes', 'linked-change');
  await mkdir(active, { recursive: true });
  await writeFile(
    path.join(active, '.openspec.yaml'),
    'schema: spec-driven\ncreated: 2026-01-01\n',
    'utf8',
  );
  await writeFile(path.join(active, 'proposal.md'), '# Linked\n', 'utf8');

  await seed(anchor, 'OI-20260101-HIGH', {
    title: 'Alpha Billing',
    description: '账单接入',
    manual: 'high',
    proposals: [
      {
        id: 'linked-change',
        path: 'openspec/changes/linked-change',
        created_at: '2026-01-01T00:00:00.000Z',
        snapshot_hash: contentHash('Alpha Billing', '账单接入'),
      },
    ],
  });
  await seed(anchor, 'OI-20260101-MED', { title: 'Beta Medium', manual: 'medium' });
  await seed(anchor, 'OI-20260101-BASE', { title: 'Base Blocker', manual: 'low' });
  await seed(anchor, 'OI-20260101-OPENBLOCK', {
    title: 'Blocked Open',
    manual: 'high',
    blockedBy: ['OI-20260101-BASE'],
  });
  await seed(anchor, 'OI-20260101-GONE', {
    title: 'Gone',
    status: 'closed',
    close: { reason: 'wontdo', note: '放弃', closed_at: '2026-01-03T00:00:00.000Z' },
  });
  await seed(anchor, 'OI-20260101-WONT', {
    title: 'Blocked Abandoned',
    manual: 'high',
    blockedBy: ['OI-20260101-GONE'],
  });
  await seed(anchor, 'OI-20260101-MISS', {
    title: 'Blocked Unknown',
    manual: 'high',
    blockedBy: ['OI-20260101-MISSING'],
  });
  await seed(anchor, 'OI-20260101-CLOSED', {
    title: 'Closed Gamma',
    status: 'closed',
    close: { reason: 'completed', closed_at: '2026-01-03T00:00:00.000Z' },
  });
  await writeFile(
    path.join(anchor.root, 'openissue', 'issues', 'broken.md'),
    '---\ntitle: [broken\n---\nraw conflict\n',
    'utf8',
  );

  const board = await startBoard({
    context: {
      anchorRoot: anchor.root,
      productDir: path.join(anchor.root, 'openissue'),
      product: await readProduct(anchor.root),
    },
    port: 0,
  });
  boards.push(board);
  return { anchor, board };
}

async function query(board: BoardServer, params: string): Promise<Record<string, unknown>> {
  const response = await fetch(`${board.url}api/state?${params}`);
  expect(response.status).toBe(200);
  const value: unknown = await response.json();
  if (!isRecord(value)) throw new Error('invalid state');
  return value;
}

function ids(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .map((item) => (typeof item.id === 'string' ? item.id : ''))
    .filter(Boolean);
}

function groupIds(state: Record<string, unknown>, group: string): string[] {
  const groups = state.groups;
  if (!isRecord(groups)) return [];
  return ids(groups[group]);
}

describe('search and filters', () => {
  it('defaults to open issues and keeps conflicts independent', async () => {
    const { board } = await setup();
    const state = await query(board, '');
    expect(ids(state.closed)).toEqual([]);
    expect(groupIds(state, 'high')).toContain('OI-20260101-HIGH');
    expect(groupIds(state, 'high')).not.toContain('OI-20260101-CLOSED');
    expect(Array.isArray(state.conflicts) && state.conflicts).toHaveLength(1);
  });

  it('searches title and description case-insensitively', async () => {
    const { board } = await setup();
    expect(groupIds(await query(board, 'q=alpha'), 'high')).toEqual(['OI-20260101-HIGH']);
    expect(groupIds(await query(board, 'q=账单'), 'high')).toEqual(['OI-20260101-HIGH']);
    const none = await query(board, 'q=zzzz-no-match');
    expect(Object.values(none.groups as Record<string, unknown>).flatMap(ids)).toEqual([]);
    expect(Array.isArray(none.conflicts) && none.conflicts).toHaveLength(1);
  });

  it('only includes closed issues when the status filter asks for them', async () => {
    const { board } = await setup();
    const closed = await query(board, 'status=closed');
    expect(ids(closed.closed).sort()).toEqual(['OI-20260101-CLOSED', 'OI-20260101-GONE']);
    expect(groupIds(closed, 'high')).toEqual([]);
    const all = await query(board, 'status=all&q=gamma');
    expect(ids(all.closed)).toEqual(['OI-20260101-CLOSED']);
    const openSearch = await query(board, 'status=open&q=gamma');
    expect(ids(openSearch.closed)).toEqual([]);
  });

  it('combines tier, linked, and blocked filters', async () => {
    const { board } = await setup();
    const high = await query(board, 'status=open&tier=high');
    expect(groupIds(high, 'high').sort()).toEqual([
      'OI-20260101-BASE',
      'OI-20260101-HIGH',
      'OI-20260101-OPENBLOCK',
    ]);
    expect(groupIds(high, 'medium')).toEqual([]);

    const linked = await query(board, 'linked=yes');
    expect(groupIds(linked, 'high')).toEqual(['OI-20260101-HIGH']);
    const linkedNo = await query(board, 'linked=no');
    expect(groupIds(linkedNo, 'high')).toContain('OI-20260101-OPENBLOCK');

    const blocked = await query(board, 'blocked=yes');
    expect(groupIds(blocked, 'high')).toContain('OI-20260101-OPENBLOCK');
    expect(groupIds(blocked, 'unassessed').sort()).toEqual([
      'OI-20260101-MISS',
      'OI-20260101-WONT',
    ]);
    expect(groupIds(blocked, 'high')).not.toContain('OI-20260101-BASE');
  });
});
