import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { startBoard } from '../../src/board/server.js';
import { isRecord } from '../../src/core/guards.js';
import { readProduct } from '../../src/storage/product.js';
import {
  createAnchor,
  createTempDir,
  issueFixture,
  runCli,
  runGit,
  type TempDir,
} from '../helpers/fixtures.js';

const cleanup: TempDir[] = [];
const boards: Array<{ close(): Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(boards.splice(0).map((board) => board.close().catch(() => undefined)));
  await Promise.all(cleanup.splice(0).map((item) => item.cleanup()));
});

function env(anchor: TempDir): NodeJS.ProcessEnv {
  return {
    OPENISSUE_HOME: path.join(anchor.root, '.home'),
    OPENISSUE_AUTHOR: '测试作者',
  };
}

async function seed(anchor: TempDir, id: string, tier: 'high' | 'medium' | 'low'): Promise<void> {
  await writeFile(
    path.join(anchor.root, 'openissue', 'issues', `${id}.md`),
    issueFixture({
      id,
      title: `需求 ${id}`,
      status: 'open',
      product: 'demo',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
      author: '测试作者',
      source: 'cli',
      blocked_by: [],
      proposals: [],
      priority: { manual_tier: tier, manual_at: '2026-01-02T00:00:00.000Z' },
    }),
    'utf8',
  );
}

async function boardFor(anchor: TempDir, deps?: Parameters<typeof startBoard>[0]['deps']) {
  const product = await readProduct(anchor.root);
  const board = await startBoard({
    context: {
      anchorRoot: anchor.root,
      productDir: path.join(anchor.root, 'openissue'),
      product,
    },
    port: 0,
    ...(deps ? { deps } : {}),
  });
  boards.push(board);
  return board;
}

async function state(url: string): Promise<Record<string, unknown>> {
  const response = await fetch(`${url}api/state`);
  expect(response.status).toBe(200);
  const value: unknown = await response.json();
  if (!isRecord(value)) throw new Error('invalid board state');
  return value;
}

describe('local board', () => {
  it('shares data with the CLI in both directions', async () => {
    const anchor = await createAnchor({ id: 'demo' });
    cleanup.push(anchor);
    const created = runCli(['create', '从命令行创建', '--json'], {
      cwd: anchor.root,
      env: env(anchor),
    });
    expect(created.status, created.stderr).toBe(0);
    const id = String(JSON.parse(created.stdout).id);
    const board = await boardFor(anchor);

    let snapshot = await state(board.url);
    const groups = snapshot.groups;
    if (!isRecord(groups) || !Array.isArray(groups.unassessed)) {
      throw new Error('invalid groups');
    }
    expect(groups.unassessed.some((item) => isRecord(item) && item.id === id)).toBe(true);

    const tierResponse = await fetch(`${board.url}api/issues/${id}/tier`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tier: 'high' }),
    });
    expect(tierResponse.status).toBe(200);
    snapshot = await state(board.url);
    if (!isRecord(snapshot.groups) || !Array.isArray(snapshot.groups.high)) {
      throw new Error('invalid groups');
    }
    expect(snapshot.groups.high.some((item) => isRecord(item) && item.id === id)).toBe(true);

    const cli = runCli(['priority', '--json'], { cwd: anchor.root, env: env(anchor) });
    expect(cli.status, cli.stderr).toBe(0);
    expect(cli.stdout).toContain('"effective_tier": "high"');
  });

  it('exposes interview state and the same start context as the CLI', async () => {
    const anchor = await createAnchor({ id: 'demo', openspec: true, focus: '先跑通收件箱' });
    cleanup.push(anchor);
    const changeDir = path.join(anchor.root, 'openspec', 'changes', 'interview-draft');
    await mkdir(changeDir, { recursive: true });
    await writeFile(
      path.join(changeDir, '.openspec.yaml'),
      'schema: spec-driven\nx-openissue-interview:\n  status: incomplete\n  issue: OI-20260101-DDDD\n  started_at: 2026-01-01T00:00:00.000Z\n  updated_at: 2026-01-01T00:00:00.000Z\n',
      'utf8',
    );
    await writeFile(path.join(changeDir, 'proposal.md'), '# Draft\n', 'utf8');
    await writeFile(
      path.join(anchor.root, 'openissue', 'issues', 'OI-20260101-DDDD.md'),
      issueFixture({
        id: 'OI-20260101-DDDD',
        title: '访谈中的需求',
        status: 'open',
        product: 'demo',
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
        author: '测试作者',
        source: 'cli',
        blocked_by: [],
        proposals: [
          {
            id: 'interview-draft',
            path: 'openspec/changes/interview-draft',
            created_at: '2026-01-01T00:00:00.000Z',
            snapshot_hash: 'deadbeef',
          },
        ],
      }),
      'utf8',
    );
    const board = await boardFor(anchor);
    const snapshot = await state(board.url);
    if (!isRecord(snapshot.groups) || !Array.isArray(snapshot.groups.unassessed)) {
      throw new Error('invalid groups');
    }
    const item = snapshot.groups.unassessed.find(
      (candidate) => isRecord(candidate) && candidate.id === 'OI-20260101-DDDD',
    );
    if (!isRecord(item) || !isRecord(item.start_context)) throw new Error('missing start context');
    expect(item.interview_incomplete).toBe(true);
    expect(item.resume_change_id).toBe('interview-draft');
    expect(item.start_context.instruction).toContain('继续未完成草稿 interview-draft');

    await writeFile(
      path.join(changeDir, '.openspec.yaml'),
      'schema: spec-driven\nx-openissue-interview:\n  status: completed\n  issue: OI-20260101-DDDD\n  started_at: 2026-01-01T00:00:00.000Z\n  updated_at: 2026-01-02T00:00:00.000Z\n  completed_at: 2026-01-02T00:00:00.000Z\n',
      'utf8',
    );
    const completedSnapshot = await state(board.url);
    if (
      !isRecord(completedSnapshot.groups) ||
      !Array.isArray(completedSnapshot.groups.unassessed)
    ) {
      throw new Error('invalid groups');
    }
    const completedItem = completedSnapshot.groups.unassessed.find(
      (candidate) => isRecord(candidate) && candidate.id === 'OI-20260101-DDDD',
    );
    if (!isRecord(completedItem) || !isRecord(completedItem.start_context)) {
      throw new Error('missing completed start context');
    }
    expect(completedItem.interview_incomplete).toBe(false);
    expect(completedItem.interview_completed).toBe(true);
    expect(completedItem.resume_change_id).toBeUndefined();
    expect(completedItem.start_context.interview).toMatchObject({ status: 'completed' });
    expect(completedItem.start_context.instruction).toContain('访谈已完成');
  });

  it('binds only to 127.0.0.1 and keeps the CLI usable after a board failure', async () => {
    const anchor = await createAnchor({ id: 'demo' });
    cleanup.push(anchor);
    await seed(anchor, 'OI-20260101-AAAA', 'high');
    const board = await boardFor(anchor);
    const address = board.server.address();
    if (!address || typeof address === 'string') throw new Error('missing address');
    expect(address.address).toBe('127.0.0.1');

    await expect(
      startBoard({
        context: {
          anchorRoot: anchor.root,
          productDir: path.join(anchor.root, 'openissue'),
          product: await readProduct(anchor.root),
        },
        port: address.port,
      }),
    ).rejects.toThrow();

    const blocked = runCli(
      ['board', '--port', String(address.port), '--no-open'],
      { cwd: anchor.root, env: env(anchor) },
    );
    expect(blocked.status).not.toBe(0);
    expect(blocked.stderr).toContain('看板启动失败');
    expect(blocked.stderr).toContain('已被占用');
    expect(blocked.stderr).toContain('--port 4311');
    expect(blocked.stderr).toContain('--port 0');
    const cli = runCli(['list', '--json'], { cwd: anchor.root, env: env(anchor) });
    expect(cli.status, cli.stderr).toBe(0);
    expect(cli.stdout).toContain('OI-20260101-AAAA');
  });

  it('reports a failed save and leaves the original record intact', async () => {
    const anchor = await createAnchor({ id: 'demo' });
    cleanup.push(anchor);
    await seed(anchor, 'OI-20260101-BBBB', 'medium');
    const file = path.join(anchor.root, 'openissue', 'issues', 'OI-20260101-BBBB.md');
    const before = await readFile(file, 'utf8');
    const board = await boardFor(anchor, {
      mutate: async () => {
        throw new Error('模拟磁盘写入失败');
      },
    });
    const response = await fetch(`${board.url}api/issues/OI-20260101-BBBB/tier`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tier: 'high' }),
    });
    expect(response.status).toBe(500);
    const body: unknown = await response.json();
    expect(isRecord(body) && body.ok).toBe(false);
    expect(await readFile(file, 'utf8')).toBe(before);
    const cli = runCli(['list', '--json'], { cwd: anchor.root, env: env(anchor) });
    expect(cli.status, cli.stderr).toBe(0);
  });

  it('shows the same records from a Git clone', async () => {
    const anchor = await createAnchor({ id: 'demo' });
    cleanup.push(anchor);
    await seed(anchor, 'OI-20260101-CCCC', 'low');
    runGit(anchor.root, ['init']);
    runGit(anchor.root, ['config', 'user.email', 'test@example.com']);
    runGit(anchor.root, ['config', 'user.name', 'Test']);
    runGit(anchor.root, ['add', '.']);
    runGit(anchor.root, ['commit', '-m', 'seed']);

    const parent = await createTempDir('openissue-clone-');
    cleanup.push(parent);
    const cloneRoot = path.join(parent.root, 'clone');
    runGit(parent.root, ['clone', anchor.root, cloneRoot]);
    const clone = { root: cloneRoot, cleanup: async () => undefined };
    const board = await boardFor(clone);
    const snapshot = await state(board.url);
    if (!isRecord(snapshot.groups) || !Array.isArray(snapshot.groups.low)) {
      throw new Error('invalid groups');
    }
    const item = snapshot.groups.low.find(
      (candidate) => isRecord(candidate) && candidate.id === 'OI-20260101-CCCC',
    );
    expect(item).toBeTruthy();
    if (isRecord(item)) {
      expect(item.author).toBe('测试作者');
      expect(item.updated_at).toBe('2026-01-01T00:00:00.000Z');
    }
  });
});
