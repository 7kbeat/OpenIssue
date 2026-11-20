import { afterEach, describe, expect, it } from 'vitest';
import { access, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { isRecord } from '../../src/core/guards.js';
import { contentHash } from '../../src/core/hash.js';
import { createProposal, readHandoffState } from '../../src/services/handoff.js';
import { findIssue } from '../../src/storage/issue.js';
import {
  createAnchor,
  issueFixture,
  runCli,
  runOpenspec,
  type TempDir,
} from '../helpers/fixtures.js';

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
    description?: string;
    status?: 'open' | 'closed';
    close?: Record<string, unknown>;
    proposals?: Array<Record<string, unknown>>;
  } = {},
): Promise<void> {
  await writeFile(
    path.join(anchor.root, 'openissue', 'issues', `${id}.md`),
    issueFixture(
      {
        id,
        title: options.title ?? '接入第三方账单',
        status: options.status ?? 'open',
        product: 'demo',
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
        author: '测试作者',
        source: 'cli',
        blocked_by: [],
        proposals: options.proposals ?? [],
        ...(options.close ? { close: options.close } : {}),
      },
      options.description ?? '账单接入需要先确认鉴权',
    ),
    'utf8',
  );
}

async function readIssue(anchor: TempDir, id: string): Promise<Record<string, unknown>> {
  const raw = await readFile(
    path.join(anchor.root, 'openissue', 'issues', `${id}.md`),
    'utf8',
  );
  const parsed = YAML.parse(raw.replace(/^---\r?\n([\s\S]*?)\r?\n---[\s\S]*$/, '$1'));
  if (!isRecord(parsed)) throw new Error('invalid issue');
  return parsed;
}

async function createActiveChange(
  anchor: TempDir,
  id: string,
  proposal = '# Existing\n\n不要修改我。\n',
): Promise<void> {
  const dir = path.join(anchor.root, 'openspec', 'changes', id);
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, '.openspec.yaml'),
    'schema: spec-driven\ncreated: 2026-01-01\n',
    'utf8',
  );
  await writeFile(path.join(dir, 'proposal.md'), proposal, 'utf8');
}

async function archiveChange(anchor: TempDir, id: string): Promise<void> {
  const from = path.join(anchor.root, 'openspec', 'changes', id);
  const to = path.join(anchor.root, 'openspec', 'changes', 'archive', `2026-01-01-${id}`);
  await mkdir(path.dirname(to), { recursive: true });
  await rename(from, to);
}

async function state(anchor: TempDir, id: string) {
  const issue = await findIssue(path.join(anchor.root, 'openissue'), 'demo', id);
  return readHandoffState(anchor.root, issue);
}

describe('OpenSpec handoff', () => {
  it('creates a proposal with known context and no generated specs or tasks', async () => {
    const anchor = await createAnchor({ id: 'demo', openspec: true, focus: '先跑通收件箱' });
    cleanup.push(anchor);
    await seed(anchor, 'OI-20260101-AAAA');

    const result = runCli(
      ['handoff', 'OI-20260101-AAAA', '--change', 'billing-integration', '--yes', '--json'],
      { cwd: anchor.root, env: env(anchor) },
    );
    expect(result.status, result.stderr).toBe(0);
    const output: unknown = JSON.parse(result.stdout);
    if (!isRecord(output) || !isRecord(output.issue)) throw new Error('invalid handoff output');
    expect(output.issue.status).toBe('open');

    const changeDir = path.join(anchor.root, 'openspec', 'changes', 'billing-integration');
    const files = (await readdir(changeDir)).sort();
    expect(files).toEqual(['.openspec.yaml', 'README.md']);
    const readme = await readFile(path.join(changeDir, 'README.md'), 'utf8');
    expect(readme).toContain('接入第三方账单');
    expect(readme).toContain('账单接入需要先确认鉴权');
    expect(readme).toContain('先跑通收件箱');
    const metadata = YAML.parse(
      await readFile(path.join(changeDir, '.openspec.yaml'), 'utf8'),
    ) as Record<string, unknown>;
    expect(metadata['x-openissue-issues']).toContain('OI-20260101-AAAA');

    const issue = await readIssue(anchor, 'OI-20260101-AAAA');
    expect(issue.status).toBe('open');
    expect(issue.proposals).toHaveLength(1);
  });

  it('falls back to the issue id for a Chinese title and keeps the issue open', async () => {
    const anchor = await createAnchor({ id: 'demo', openspec: true });
    cleanup.push(anchor);
    await seed(anchor, 'OI-20260101-BBBB', { title: '中文标题无法转写' });
    const result = runCli(
      ['handoff', 'OI-20260101-BBBB', '--yes', '--json'],
      { cwd: anchor.root, env: env(anchor) },
    );
    expect(result.status, result.stderr).toBe(0);
    const changes = await readdir(path.join(anchor.root, 'openspec', 'changes'));
    const created = changes.find((name) => name !== 'archive' && name !== 'specs');
    expect(created).toBe('oi-20260101-bbbb');
    expect((await readIssue(anchor, 'OI-20260101-BBBB')).status).toBe('open');
  });

  it('refuses to create without OpenSpec or on a name conflict, and cleans up a failed create', async () => {
    const missing = await createAnchor({ id: 'demo' });
    cleanup.push(missing);
    await seed(missing, 'OI-20260101-CCCC');
    const noOpenspec = runCli(
      ['handoff', 'OI-20260101-CCCC', '--change', 'new-change', '--yes'],
      { cwd: missing.root, env: env(missing) },
    );
    expect(noOpenspec.status).not.toBe(0);
    expect(noOpenspec.stderr).toContain('OpenSpec');
    await expect(access(path.join(missing.root, 'openspec'))).rejects.toThrow();
    expect(await readIssue(missing, 'OI-20260101-CCCC')).toMatchObject({ status: 'open' });

    const conflict = await createAnchor({ id: 'demo', openspec: true });
    cleanup.push(conflict);
    await seed(conflict, 'OI-20260101-DDDD');
    await createActiveChange(conflict, 'existing-change');
    const conflictResult = runCli(
      ['handoff', 'OI-20260101-DDDD', '--change', 'existing-change', '--yes'],
      { cwd: conflict.root, env: env(conflict) },
    );
    expect(conflictResult.status).not.toBe(0);
    expect(conflictResult.stderr).toContain('已存在');
    expect((await readIssue(conflict, 'OI-20260101-DDDD')).proposals).toEqual([]);

    const failing = await createAnchor({ id: 'demo', openspec: true });
    cleanup.push(failing);
    await seed(failing, 'OI-20260101-EEEE');
    const issue = await findIssue(path.join(failing.root, 'openissue'), 'demo', 'OI-20260101-EEEE');
    const productDir = path.join(failing.root, 'openissue');
    await expect(
      createProposal({
        anchorRoot: failing.root,
        productDir,
        productId: 'demo',
        issue,
        changeId: 'partial-change',
        focus: '',
        runner: async (_args, cwd) => {
          await mkdir(path.join(cwd, 'openspec', 'changes', 'partial-change'), {
            recursive: true,
          });
          throw new Error('模拟创建失败');
        },
      }),
    ).rejects.toThrow('模拟创建失败');
    await expect(
      access(path.join(failing.root, 'openspec', 'changes', 'partial-change')),
    ).rejects.toThrow();
    expect((await readIssue(failing, 'OI-20260101-EEEE')).proposals).toEqual([]);
  });

  it('links an existing proposal without copying or rewriting it', async () => {
    const anchor = await createAnchor({ id: 'demo', openspec: true });
    cleanup.push(anchor);
    await seed(anchor, 'OI-20260101-FFFF');
    const proposal = '# Existing Proposal\n\n保持原样。\n';
    await createActiveChange(anchor, 'existing-change', proposal);
    const result = runCli(
      ['handoff', 'OI-20260101-FFFF', '--link', 'existing-change', '--json'],
      { cwd: anchor.root, env: env(anchor) },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(
      await readFile(
        path.join(anchor.root, 'openspec', 'changes', 'existing-change', 'proposal.md'),
        'utf8',
      ),
    ).toBe(proposal);
    const issue = await readIssue(anchor, 'OI-20260101-FFFF');
    expect(issue.status).toBe('open');
    expect(issue.proposals).toHaveLength(1);
    const metadata = YAML.parse(
      await readFile(
        path.join(anchor.root, 'openspec', 'changes', 'existing-change', '.openspec.yaml'),
        'utf8',
      ),
    ) as Record<string, unknown>;
    expect(metadata['x-openissue-issues']).toEqual(['OI-20260101-FFFF']);
  });

  it('waits for all linked proposals to archive before confirming completion', async () => {
    const anchor = await createAnchor({ id: 'demo', openspec: true });
    cleanup.push(anchor);
    await seed(anchor, 'OI-20260101-GGGG');
    for (const change of ['change-one', 'change-two']) {
      const created = runCli(
        ['handoff', 'OI-20260101-GGGG', '--change', change, '--yes'],
        { cwd: anchor.root, env: env(anchor) },
      );
      expect(created.status, created.stderr).toBe(0);
    }
    await archiveChange(anchor, 'change-one');
    let handoff = await state(anchor, 'OI-20260101-GGGG');
    expect(handoff.archived_pending).toBe(false);
    expect(handoff.link_invalid).toBe(false);
    const early = runCli(['confirm', 'OI-20260101-GGGG'], {
      cwd: anchor.root,
      env: env(anchor),
    });
    expect(early.status).not.toBe(0);
    expect((await readIssue(anchor, 'OI-20260101-GGGG')).status).toBe('open');

    await archiveChange(anchor, 'change-two');
    handoff = await state(anchor, 'OI-20260101-GGGG');
    expect(handoff.archived_pending).toBe(true);
    const confirmed = runCli(['confirm', 'OI-20260101-GGGG', '--json'], {
      cwd: anchor.root,
      env: env(anchor),
    });
    expect(confirmed.status, confirmed.stderr).toBe(0);
    expect(await readIssue(anchor, 'OI-20260101-GGGG')).toMatchObject({
      status: 'closed',
      close: { reason: 'completed' },
    });
    expect((await state(anchor, 'OI-20260101-GGGG')).archived_pending).toBe(false);
  });

  it('replaces a missing link, supports manual close, and hides completion prompts for closed issues', async () => {
    const anchor = await createAnchor({ id: 'demo', openspec: true });
    cleanup.push(anchor);
    await seed(anchor, 'OI-20260101-HHHH', {
      proposals: [
        {
          id: 'missing-change',
          path: 'openspec/changes/missing-change',
          created_at: '2026-01-01T00:00:00.000Z',
          snapshot_hash: contentHash('接入第三方账单', '账单接入需要先确认鉴权'),
        },
      ],
    });
    let handoff = await state(anchor, 'OI-20260101-HHHH');
    expect(handoff.link_invalid).toBe(true);
    expect((await readIssue(anchor, 'OI-20260101-HHHH')).status).toBe('open');

    await createActiveChange(anchor, 'replacement-change');
    const relinked = runCli(
      ['handoff', 'OI-20260101-HHHH', '--link', 'replacement-change'],
      { cwd: anchor.root, env: env(anchor) },
    );
    expect(relinked.status, relinked.stderr).toBe(0);
    const issue = await readIssue(anchor, 'OI-20260101-HHHH');
    expect(issue.proposals).toHaveLength(1);
    handoff = await state(anchor, 'OI-20260101-HHHH');
    expect(handoff.link_invalid).toBe(false);

    await rm(path.join(anchor.root, 'openspec', 'changes', 'replacement-change'), {
      recursive: true,
      force: true,
    });
    handoff = await state(anchor, 'OI-20260101-HHHH');
    expect(handoff.link_invalid).toBe(true);
    const closed = runCli(
      ['close', 'OI-20260101-HHHH', '--reason', 'completed'],
      { cwd: anchor.root, env: env(anchor) },
    );
    expect(closed.status, closed.stderr).toBe(0);
    expect(closed.stdout).toContain('提案不会因此取消或改变');
    expect(await readIssue(anchor, 'OI-20260101-HHHH')).toMatchObject({ status: 'closed' });
    expect((await state(anchor, 'OI-20260101-HHHH')).archived_pending).toBe(false);
  });

  it('shows snapshot differences and clears them after restoring the content', async () => {
    const anchor = await createAnchor({ id: 'demo', openspec: true });
    cleanup.push(anchor);
    await seed(anchor, 'OI-20260101-IIII');
    const created = runCli(
      ['handoff', 'OI-20260101-IIII', '--change', 'snapshot-change', '--yes'],
      { cwd: anchor.root, env: env(anchor) },
    );
    expect(created.status, created.stderr).toBe(0);
    const readmePath = path.join(
      anchor.root,
      'openspec',
      'changes',
      'snapshot-change',
      'README.md',
    );
    const before = await readFile(readmePath, 'utf8');
    const edited = runCli(
      ['edit', 'OI-20260101-IIII', '--title', '标题已经变化'],
      { cwd: anchor.root, env: env(anchor) },
    );
    expect(edited.status, edited.stderr).toBe(0);
    expect((await state(anchor, 'OI-20260101-IIII')).updated_since_proposal).toBe(true);
    expect(await readFile(readmePath, 'utf8')).toBe(before);

    const restored = runCli(
      ['edit', 'OI-20260101-IIII', '--title', '接入第三方账单'],
      { cwd: anchor.root, env: env(anchor) },
    );
    expect(restored.status, restored.stderr).toBe(0);
    expect((await state(anchor, 'OI-20260101-IIII')).updated_since_proposal).toBe(false);
    expect(await readFile(readmePath, 'utf8')).toBe(before);
  });

  it('validates and archives a real OpenSpec 1.10.0 change', async () => {
    const anchor = await createAnchor({ id: 'demo', openspec: true });
    cleanup.push(anchor);
    await seed(anchor, 'OI-20260101-JJJJ');
    const created = runCli(
      ['handoff', 'OI-20260101-JJJJ', '--change', 'real-change', '--yes'],
      { cwd: anchor.root, env: env(anchor) },
    );
    expect(created.status, created.stderr).toBe(0);
    const changeDir = path.join(anchor.root, 'openspec', 'changes', 'real-change');
    await writeFile(
      path.join(changeDir, 'proposal.md'),
      '# Real Change\n\n## Why\n\n需要完成。\n\n## What Changes\n\n- 新增能力。\n',
      'utf8',
    );
    await writeFile(path.join(changeDir, 'tasks.md'), '- [x] 完成\n', 'utf8');
    await mkdir(path.join(changeDir, 'specs', 'billing'), { recursive: true });
    await writeFile(
      path.join(changeDir, 'specs', 'billing', 'spec.md'),
      '## ADDED Requirements\n\n### Requirement: 账单\n\n系统 SHALL 支持账单。\n\n#### Scenario: 成功\n\n- **WHEN** 用户配置\n- **THEN** 系统保存\n',
      'utf8',
    );
    const validation = runOpenspec(anchor.root, ['validate', 'real-change', '--strict']);
    expect(validation.status, validation.stderr).toBe(0);
    const archived = runOpenspec(anchor.root, ['archive', 'real-change', '--yes', '--json']);
    expect(archived.status, archived.stderr).toBe(0);
    const archiveRoot = path.join(anchor.root, 'openspec', 'changes', 'archive');
    const archiveEntries = await readdir(archiveRoot);
    const archivedName = archiveEntries.find((name) => name.endsWith('-real-change'));
    expect(archivedName).toBeTruthy();
    await access(path.join(archiveRoot, archivedName!));
    const handoff = await state(anchor, 'OI-20260101-JJJJ');
    expect(handoff.archived_pending).toBe(true);
    const confirmed = runCli(['confirm', 'OI-20260101-JJJJ'], {
      cwd: anchor.root,
      env: env(anchor),
    });
    expect(confirmed.status, confirmed.stderr).toBe(0);
    expect((await readIssue(anchor, 'OI-20260101-JJJJ')).status).toBe('closed');
  });
});
