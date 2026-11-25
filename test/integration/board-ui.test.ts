import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { startBoard } from '../../src/board/server.js';
import type { BoardSnapshot } from '../../src/board/types.js';
import { isRecord } from '../../src/core/guards.js';
import { readProduct } from '../../src/storage/product.js';
import {
  createAnchor,
  createMember,
  issueFixture,
  type TempDir,
} from '../helpers/fixtures.js';

const cleanup: TempDir[] = [];
const boards: Array<{ close(): Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(boards.splice(0).map((board) => board.close().catch(() => undefined)));
  await Promise.all(cleanup.splice(0).map((item) => item.cleanup()));
});

async function start(anchor: TempDir) {
  const board = await startBoard({
    context: {
      anchorRoot: anchor.root,
      productDir: path.join(anchor.root, 'openissue'),
      product: await readProduct(anchor.root),
    },
    port: 0,
  });
  boards.push(board);
  return board;
}

async function getState(url: string): Promise<BoardSnapshot> {
  const response = await fetch(`${url}api/board/state`);
  expect(response.status).toBe(200);
  return (await response.json()) as BoardSnapshot;
}

async function writeIssue(
  anchor: TempDir,
  id: string,
  fields: Record<string, unknown>,
  description = '',
): Promise<void> {
  await writeFile(
    path.join(anchor.root, 'openissue', 'issues', `${id}.md`),
    issueFixture(
      {
        id,
        status: 'open',
        product: 'demo',
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
        author: '测试作者',
        source: 'cli',
        blocked_by: [],
        proposals: [],
        ...fields,
      },
      description,
    ),
    'utf8',
  );
}

async function writeChange(
  anchor: TempDir,
  id: string,
  options: { archived?: boolean; linked?: string[]; tasks?: string[] } = {},
): Promise<void> {
  const folder = options.archived ? `2026-01-01-${id}` : id;
  const dir = path.join(
    anchor.root,
    'openspec',
    'changes',
    ...(options.archived ? ['archive'] : []),
    folder,
  );
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, '.openspec.yaml'),
    [
      'schema: spec-driven',
      ...(options.archived ? ['archived_at: 2026-01-02T00:00:00.000Z'] : []),
      ...(options.linked?.length ? ['x-openissue-issues:', ...options.linked.map((id) => `  - ${id}`)] : []),
      '',
    ].join('\n'),
    'utf8',
  );
  await writeFile(path.join(dir, 'proposal.md'), `# ${id}\n\n${id} 描述\n`, 'utf8');
  await writeFile(
    path.join(dir, 'tasks.md'),
    (options.tasks ?? ['- [ ] 1. todo']).join('\n'),
    'utf8',
  );
}

describe('board view snapshot', () => {
  it('wires workspace, product, facts, issues, evaluation, conflicts, and files', async () => {
    const anchor = await createAnchor({
      id: 'demo',
      name: 'Demo Product',
      focus: '先跑通收件箱',
      openspec: true,
      members: [{ id: 'web', name: 'Web', path: '../web' }],
    });
    cleanup.push(anchor);
    await mkdir(path.join(anchor.root, 'openspec', 'specs', 'workspace'), { recursive: true });
    await writeFile(
      path.join(anchor.root, 'openspec', 'specs', 'workspace', 'spec.md'),
      '# 工作区\n\n唯一锚点与成员指针。\n',
      'utf8',
    );
    await writeChange(anchor, 'active-change', {
      linked: ['OI-20260101-HIGH'],
      tasks: ['- [x] 1. done', '- [ ] 2. todo'],
    });
    await writeChange(anchor, 'archived-change', { archived: true });
    await writeIssue(
      anchor,
      'OI-20260101-HIGH',
      {
        title: '高优需求',
        blocked_by: ['OI-20260101-BASE'],
        proposals: [
          {
            id: 'active-change',
            path: 'openspec/changes/active-change',
            created_at: '2026-01-01T00:00:00.000Z',
            snapshot_hash: 'deadbeef',
          },
        ],
        priority: {
          tier: 'high',
          reason: '推进当前重点',
          basis: ['focus'],
          judged_at: '2026-01-02T00:00:00.000Z',
          source: 'assistant',
        },
        custom_field: 'preserved',
      },
      '高优需求描述',
    );
    await writeIssue(anchor, 'OI-20260101-BASE', {
      title: '基础需求',
      priority: { manual_tier: 'low', manual_at: '2026-01-02T00:00:00.000Z' },
    });
    await writeIssue(anchor, 'OI-20260101-CLOSED', {
      title: '关闭需求',
      status: 'closed',
      close: {
        reason: 'wontdo',
        note: '范围外',
        closed_at: '2026-01-03T00:00:00.000Z',
      },
    });
    await writeFile(
      path.join(anchor.root, 'openissue', 'issues', 'broken.md'),
      '---\ntitle: [broken\n---\nraw\n',
      'utf8',
    );

    const board = await start(anchor);
    const snapshot = await getState(board.url);

    expect(snapshot.workspace).toMatchObject({
      mode: 'anchor',
      currentRepoName: path.basename(anchor.root),
      selectedProductId: 'demo',
      openspecInitialized: true,
    });
    expect(snapshot.product).toMatchObject({
      id: 'demo',
      name: 'Demo Product',
      focus: { text: '先跑通收件箱' },
      members: [{ id: 'web', name: 'Web', path: '../web' }],
    });
    expect(snapshot.facts.openspecInitialized).toBe(true);
    expect(snapshot.facts.specs).toEqual([
      expect.objectContaining({ id: 'workspace', name: '工作区' }),
    ]);
    expect(snapshot.facts.activeChanges).toHaveLength(1);
    expect(snapshot.facts.activeChanges[0]).toMatchObject({
      id: 'active-change',
      tasks: { done: 1, total: 2 },
      x_openissue_issues: ['OI-20260101-HIGH'],
    });
    expect(snapshot.facts.archivedChanges[0]).toMatchObject({
      id: 'archived-change',
      archived_at: '2026-01-02T00:00:00.000Z',
    });
    expect(snapshot.issues).toHaveLength(3);
    const high = snapshot.issues.find((issue) => issue.id === 'OI-20260101-HIGH');
    expect(high).toMatchObject({
      title: '高优需求',
      description: '高优需求描述',
      product_id: 'demo',
      author: '测试作者',
      source: 'cli',
      rawFrontmatter: expect.objectContaining({ custom_field: 'preserved' }),
    });
    expect(high?.rawMarkdown).toContain('custom_field: preserved');
    const evaluated = snapshot.evaluated.find((item) => item.issue.id === 'OI-20260101-HIGH');
    expect(evaluated).toMatchObject({
      effectiveTier: '高',
      precedenceStage: 'assistant_judgment',
      isBlocked: true,
      proposalStatuses: [
        expect.objectContaining({
          id: 'active-change',
          state: 'active',
          tasks: { done: 1, total: 2 },
        }),
      ],
    });
    expect(snapshot.evaluated.find((item) => item.issue.id === 'OI-20260101-BASE')).toMatchObject({
      effectiveTier: '高',
      precedenceStage: 'dependency_floor',
      isManual: true,
      manualOverriddenByRule: true,
    });
    expect(snapshot.evaluated.find((item) => item.issue.id === 'OI-20260101-CLOSED')).toMatchObject({
      effectiveTier: null,
      precedenceStage: 'closed_excluded',
    });
    expect(snapshot.conflicts[0]).toMatchObject({
      fileName: 'broken.md',
      rawContent: expect.stringContaining('raw'),
    });
    expect(snapshot.files.map((file) => file.path)).toEqual(
      expect.arrayContaining([
        'openissue/product.yaml',
        'openissue/issues/OI-20260101-HIGH.md',
        'openspec/specs/workspace/spec.md',
        'openspec/changes/active-change/.openspec.yaml',
      ]),
    );
  });
});

describe('board workspace view', () => {
  it('reports a member entry point and includes the member pointer', async () => {
    const anchor = await createAnchor({ id: 'demo', openspec: true });
    cleanup.push(anchor);
    await writeIssue(anchor, 'OI-20260101-AAAA', { title: 'A' });
    const member = await createMember([{ id: 'demo', anchor: anchor.root }]);
    cleanup.push(member);
    const board = await startBoard({
      context: {
        anchorRoot: anchor.root,
        productDir: path.join(anchor.root, 'openissue'),
        product: await readProduct(anchor.root),
        memberRoot: member.root,
      },
      port: 0,
    });
    boards.push(board);
    const snapshot = await getState(board.url);
    expect(snapshot.workspace).toMatchObject({
      mode: 'member',
      currentRepoName: path.basename(member.root),
    });
    expect(snapshot.workspace.memberRoot?.replaceAll('\\', '/')).toBe(
      member.root.replaceAll('\\', '/'),
    );
    expect(snapshot.files.map((file) => file.path)).toContain(
      'member/openissue-project.yaml',
    );
  });
});

describe('board data actions', () => {
  it('updates focus, dependencies, tiers, lifecycle, and archives changes', async () => {
    const anchor = await createAnchor({ id: 'demo', openspec: true, focus: '初始重点' });
    cleanup.push(anchor);
    await writeIssue(anchor, 'OI-20260101-AAAA', { title: 'A' });
    await writeIssue(anchor, 'OI-20260101-BBBB', { title: 'B' });
    await writeIssue(anchor, 'OI-20260101-CCCC', { title: 'C' });
    await writeChange(anchor, 'draft-change', { tasks: ['- [ ] 1. todo'] });
    const board = await start(anchor);

    let response = await fetch(`${board.url}api/board/focus`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: '新的重点' }),
    });
    expect(response.status).toBe(200);
    let snapshot = (await response.json()) as BoardSnapshot;
    expect(snapshot.product.focus?.text).toBe('新的重点');

    response = await fetch(`${board.url}api/board/issues/OI-20260101-AAAA/dependencies`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ blockerId: 'OI-20260101-BBBB' }),
    });
    expect(response.status).toBe(200);
    snapshot = (await response.json()) as BoardSnapshot;
    expect(
      snapshot.evaluated.find((item) => item.issue.id === 'OI-20260101-AAAA')?.upstreamDeps,
    ).toEqual([expect.objectContaining({ id: 'OI-20260101-BBBB' })]);

    response = await fetch(`${board.url}api/board/issues/OI-20260101-AAAA/dependencies`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ blockerId: 'OI-20260101-BBBB' }),
    });
    expect(response.status).toBe(200);
    snapshot = (await response.json()) as BoardSnapshot;
    expect(snapshot.issues.find((issue) => issue.id === 'OI-20260101-AAAA')?.blocked_by).toEqual(
      [],
    );

    response = await fetch(
      `${board.url}api/board/issues/OI-20260101-AAAA/dependencies/replace`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          oldBlockerId: 'OI-20260101-BBBB',
          newBlockerId: 'OI-20260101-CCCC',
        }),
      },
    );
    expect(response.status).toBe(200);
    snapshot = (await response.json()) as BoardSnapshot;
    expect(snapshot.issues.find((issue) => issue.id === 'OI-20260101-AAAA')?.blocked_by).toEqual([
      'OI-20260101-CCCC',
    ]);

    response = await fetch(`${board.url}api/board/issues/OI-20260101-BBBB/tier`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ manual_tier: '高' }),
    });
    expect(response.status).toBe(200);
    snapshot = (await response.json()) as BoardSnapshot;
    expect(snapshot.issues.find((issue) => issue.id === 'OI-20260101-BBBB')?.priority).toMatchObject({
      manual_tier: '高',
    });

    response = await fetch(`${board.url}api/board/issues/OI-20260101-CCCC/close`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'wont_do', note: '范围外' }),
    });
    expect(response.status).toBe(200);
    snapshot = (await response.json()) as BoardSnapshot;
    expect(snapshot.issues.find((issue) => issue.id === 'OI-20260101-CCCC')?.close).toMatchObject({
      reason: 'wont_do',
      note: '范围外',
    });

    response = await fetch(`${board.url}api/board/issues/OI-20260101-CCCC/reopen`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    });
    expect(response.status).toBe(200);
    snapshot = (await response.json()) as BoardSnapshot;
    expect(snapshot.issues.find((issue) => issue.id === 'OI-20260101-CCCC')?.status).toBe('open');

    response = await fetch(`${board.url}api/board/openspec/archive/draft-change`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    });
    expect(response.status).toBe(200);
    snapshot = (await response.json()) as BoardSnapshot;
    expect(snapshot.facts.activeChanges).toHaveLength(0);
    expect(snapshot.facts.archivedChanges[0]?.id).toBe('draft-change');
    expect(
      await readFile(
        path.join(
          anchor.root,
          'openspec',
          'changes',
          'archive',
          snapshot.facts.archivedChanges[0]!.path.split('/').at(-1)!,
          '.openspec.yaml',
        ),
        'utf8',
      ),
    ).toContain('archived_at');
  });

  it('emits the assistant request and applies validated results with isolation', async () => {
    const anchor = await createAnchor({ id: 'demo', openspec: true, focus: '当前重点' });
    cleanup.push(anchor);
    await writeIssue(anchor, 'OI-20260101-AAAA', { title: 'A' });
    await writeIssue(anchor, 'OI-20260101-BBBB', { title: 'B' });
    const board = await start(anchor);

    const emitResponse = await fetch(`${board.url}api/board/prioritize/emit`);
    expect(emitResponse.status).toBe(200);
    const request = (await emitResponse.json()) as {
      request_hash: string;
      issues: Array<{ id: string; input_hash: string }>;
    };
    expect(request.request_hash).toBeTruthy();
    const first = request.issues[0]!;

    const applyResponse = await fetch(`${board.url}api/board/prioritize/apply`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        results: [
          {
            id: first.id,
            tier: 'high',
            reason: '结合当前重点判断',
            basis: ['focus'],
            input_hash: first.input_hash,
          },
          {
            id: 'OI-20260101-BBBB',
            tier: 'high',
            reason: '引用不存在依据',
            basis: ['fabricated'],
            input_hash: 'bad-hash',
          },
        ],
      }),
    });
    expect(applyResponse.status).toBe(200);
    const body = (await applyResponse.json()) as {
      result: { applied: string[]; errors: string[] };
      snapshot: BoardSnapshot;
    };
    expect(body.result.applied).toEqual([first.id]);
    expect(body.result.errors).toHaveLength(1);
    expect(body.snapshot.issues.find((issue) => issue.id === first.id)?.priority).toMatchObject({
      tier: '高',
      reason: '结合当前重点判断',
      source: 'assistant',
    });
  });
});
