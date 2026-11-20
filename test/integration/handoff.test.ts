import { afterEach, describe, expect, it } from 'vitest';
import { access, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { isRecord } from '../../src/core/guards.js';
import { contentHash } from '../../src/core/hash.js';
import { readHandoffState } from '../../src/services/handoff.js';
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

async function createDraftAndLink(
  anchor: TempDir,
  issueId: string,
  changeId: string,
): Promise<void> {
  const created = runOpenspec(anchor.root, [
    'new',
    'change',
    changeId,
    '--description',
    '访谈草稿',
    '--json',
  ]);
  expect(created.status, created.stderr).toBe(0);
  const linked = runCli(
    ['handoff', issueId, '--link', changeId, '--from-interview', '--json'],
    { cwd: anchor.root, env: env(anchor) },
  );
  expect(linked.status, linked.stderr).toBe(0);
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
  it('links an interview draft without copying or rewriting its content', async () => {
    const anchor = await createAnchor({ id: 'demo', openspec: true, focus: '先跑通收件箱' });
    cleanup.push(anchor);
    await seed(anchor, 'OI-20260101-AAAA');
    const proposal = '# Existing Proposal\n\n保持原样。\n';
    await createActiveChange(anchor, 'billing-integration', proposal);

    const result = runCli(
      ['handoff', 'OI-20260101-AAAA', '--link', 'billing-integration', '--from-interview', '--json'],
      { cwd: anchor.root, env: env(anchor) },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(
      await readFile(
        path.join(anchor.root, 'openspec', 'changes', 'billing-integration', 'proposal.md'),
        'utf8',
      ),
    ).toBe(proposal);
    const metadataValue: unknown = YAML.parse(
      await readFile(
        path.join(anchor.root, 'openspec', 'changes', 'billing-integration', '.openspec.yaml'),
        'utf8',
      ),
    );
    if (!isRecord(metadataValue)) throw new Error('invalid metadata');
    const metadata = metadataValue;
    expect(metadata['x-openissue-issues']).toEqual(['OI-20260101-AAAA']);
    expect(metadata['x-openissue-interview']).toMatchObject({
      status: 'incomplete',
      issue: 'OI-20260101-AAAA',
    });
    const issue = await readIssue(anchor, 'OI-20260101-AAAA');
    expect(issue.status).toBe('open');
    expect(issue.proposals).toHaveLength(1);
  });

  it('refuses to link without OpenSpec or a target change and leaves the issue unchanged', async () => {
    const missing = await createAnchor({ id: 'demo' });
    cleanup.push(missing);
    await seed(missing, 'OI-20260101-BBBB');
    const noOpenspec = runCli(
      ['handoff', 'OI-20260101-BBBB', '--link', 'missing-change'],
      { cwd: missing.root, env: env(missing) },
    );
    expect(noOpenspec.status).not.toBe(0);
    expect(noOpenspec.stderr).toContain('OpenSpec');
    expect((await readIssue(missing, 'OI-20260101-BBBB')).proposals).toEqual([]);

    const noTarget = await createAnchor({ id: 'demo', openspec: true });
    cleanup.push(noTarget);
    await seed(noTarget, 'OI-20260101-CCCC');
    const missingChange = runCli(
      ['handoff', 'OI-20260101-CCCC', '--link', 'missing-change'],
      { cwd: noTarget.root, env: env(noTarget) },
    );
    expect(missingChange.status).not.toBe(0);
    expect(missingChange.stderr).toContain('找不到活跃提案');
    expect((await readIssue(noTarget, 'OI-20260101-CCCC')).proposals).toEqual([]);
  });

  it('waits for all linked proposals to archive before confirming completion', async () => {
    const anchor = await createAnchor({ id: 'demo', openspec: true });
    cleanup.push(anchor);
    await seed(anchor, 'OI-20260101-DDDD');
    for (const change of ['change-one', 'change-two']) {
      await createActiveChange(anchor, change);
      const linked = runCli(
        ['handoff', 'OI-20260101-DDDD', '--link', change, '--from-interview'],
        { cwd: anchor.root, env: env(anchor) },
      );
      expect(linked.status, linked.stderr).toBe(0);
    }
    await archiveChange(anchor, 'change-one');
    let handoff = await state(anchor, 'OI-20260101-DDDD');
    expect(handoff.archived_pending).toBe(false);
    expect(handoff.link_invalid).toBe(false);
    const early = runCli(['confirm', 'OI-20260101-DDDD'], {
      cwd: anchor.root,
      env: env(anchor),
    });
    expect(early.status).not.toBe(0);
    expect((await readIssue(anchor, 'OI-20260101-DDDD')).status).toBe('open');

    await archiveChange(anchor, 'change-two');
    handoff = await state(anchor, 'OI-20260101-DDDD');
    expect(handoff.archived_pending).toBe(true);
    const confirmed = runCli(['confirm', 'OI-20260101-DDDD', '--json'], {
      cwd: anchor.root,
      env: env(anchor),
    });
    expect(confirmed.status, confirmed.stderr).toBe(0);
    expect(await readIssue(anchor, 'OI-20260101-DDDD')).toMatchObject({
      status: 'closed',
      close: { reason: 'completed' },
    });
    expect((await state(anchor, 'OI-20260101-DDDD')).archived_pending).toBe(false);
  });

  it('replaces a missing link, supports manual close, and hides completion prompts for closed issues', async () => {
    const anchor = await createAnchor({ id: 'demo', openspec: true });
    cleanup.push(anchor);
    await seed(anchor, 'OI-20260101-EEEE', {
      proposals: [
        {
          id: 'missing-change',
          path: 'openspec/changes/missing-change',
          created_at: '2026-01-01T00:00:00.000Z',
          snapshot_hash: contentHash('接入第三方账单', '账单接入需要先确认鉴权'),
        },
      ],
    });
    let handoff = await state(anchor, 'OI-20260101-EEEE');
    expect(handoff.link_invalid).toBe(true);
    expect((await readIssue(anchor, 'OI-20260101-EEEE')).status).toBe('open');

    await createActiveChange(anchor, 'replacement-change');
    const relinked = runCli(
      ['handoff', 'OI-20260101-EEEE', '--link', 'replacement-change'],
      { cwd: anchor.root, env: env(anchor) },
    );
    expect(relinked.status, relinked.stderr).toBe(0);
    const issue = await readIssue(anchor, 'OI-20260101-EEEE');
    expect(issue.proposals).toHaveLength(1);
    handoff = await state(anchor, 'OI-20260101-EEEE');
    expect(handoff.link_invalid).toBe(false);

    await rm(path.join(anchor.root, 'openspec', 'changes', 'replacement-change'), {
      recursive: true,
      force: true,
    });
    handoff = await state(anchor, 'OI-20260101-EEEE');
    expect(handoff.link_invalid).toBe(true);
    const closed = runCli(
      ['close', 'OI-20260101-EEEE', '--reason', 'completed'],
      { cwd: anchor.root, env: env(anchor) },
    );
    expect(closed.status, closed.stderr).toBe(0);
    expect(closed.stdout).toContain('提案不会因此取消或改变');
    expect(await readIssue(anchor, 'OI-20260101-EEEE')).toMatchObject({ status: 'closed' });
    expect((await state(anchor, 'OI-20260101-EEEE')).archived_pending).toBe(false);
  });

  it('shows snapshot differences and clears them after restoring the content', async () => {
    const anchor = await createAnchor({ id: 'demo', openspec: true });
    cleanup.push(anchor);
    await seed(anchor, 'OI-20260101-FFFF');
    await createDraftAndLink(anchor, 'OI-20260101-FFFF', 'snapshot-change');
    const readmePath = path.join(
      anchor.root,
      'openspec',
      'changes',
      'snapshot-change',
      'README.md',
    );
    const before = await readFile(readmePath, 'utf8');
    const edited = runCli(
      ['edit', 'OI-20260101-FFFF', '--title', '标题已经变化'],
      { cwd: anchor.root, env: env(anchor) },
    );
    expect(edited.status, edited.stderr).toBe(0);
    expect((await state(anchor, 'OI-20260101-FFFF')).updated_since_proposal).toBe(true);
    expect(await readFile(readmePath, 'utf8')).toBe(before);

    const restored = runCli(
      ['edit', 'OI-20260101-FFFF', '--title', '接入第三方账单'],
      { cwd: anchor.root, env: env(anchor) },
    );
    expect(restored.status, restored.stderr).toBe(0);
    expect((await state(anchor, 'OI-20260101-FFFF')).updated_since_proposal).toBe(false);
    expect(await readFile(readmePath, 'utf8')).toBe(before);
  });

  it('validates and archives a real OpenSpec 1.10.0 change', async () => {
    const anchor = await createAnchor({ id: 'demo', openspec: true });
    cleanup.push(anchor);
    await seed(anchor, 'OI-20260101-GGGG');
    await createDraftAndLink(anchor, 'OI-20260101-GGGG', 'real-change');
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
    const handoff = await state(anchor, 'OI-20260101-GGGG');
    expect(handoff.archived_pending).toBe(true);
    const confirmed = runCli(['confirm', 'OI-20260101-GGGG'], {
      cwd: anchor.root,
      env: env(anchor),
    });
    expect(confirmed.status, confirmed.stderr).toBe(0);
    expect((await readIssue(anchor, 'OI-20260101-GGGG')).status).toBe('closed');
  });
});
