import { afterEach, describe, expect, it } from 'vitest';
import { access, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { isRecord } from '../../src/core/guards.js';
import { contentHash } from '../../src/core/hash.js';
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

async function installSkills(anchor: TempDir): Promise<void> {
  const result = runCli(['skills', 'install', '--tool', 'agents', '--json'], {
    cwd: anchor.root,
    env: env(anchor),
  });
  expect(result.status, result.stderr).toBe(0);
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
  const raw = await readFile(path.join(anchor.root, 'openissue', 'issues', `${id}.md`), 'utf8');
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

async function metadata(anchor: TempDir, changeId: string): Promise<Record<string, unknown>> {
  const parsed = YAML.parse(
    await readFile(
      path.join(anchor.root, 'openspec', 'changes', changeId, '.openspec.yaml'),
      'utf8',
    ),
  );
  if (!isRecord(parsed)) throw new Error('invalid metadata');
  return parsed;
}

describe('OpenIssue start entry', () => {
  it('outputs issue context and an agent instruction without writing files', async () => {
    const anchor = await createAnchor({ id: 'demo', openspec: true, focus: '先跑通收件箱' });
    cleanup.push(anchor);
    await installSkills(anchor);
    await seed(anchor, 'OI-20260101-AAAA', { title: 'Billing integration' });
    const issueBefore = await readFile(
      path.join(anchor.root, 'openissue', 'issues', 'OI-20260101-AAAA.md'),
      'utf8',
    );
    const changesBefore = (await readdir(path.join(anchor.root, 'openspec', 'changes'))).sort();

    const result = runCli(['start', 'OI-20260101-AAAA', '--json'], {
      cwd: anchor.root,
      env: env(anchor),
    });
    expect(result.status, result.stderr).toBe(0);
    const output = JSON.parse(result.stdout) as {
      issue: { id: string; title: string; status: string };
      focus: string;
      suggested_change_id: string;
      active_proposals: unknown[];
      instruction: string;
      interview: { status: string };
    };
    expect(output.issue).toMatchObject({
      id: 'OI-20260101-AAAA',
      title: 'Billing integration',
      status: 'open',
    });
    expect(output.focus).toBe('先跑通收件箱');
    expect(output.suggested_change_id).toBe('billing-integration');
    expect(output.active_proposals).toEqual([]);
    expect(output.interview.status).toBe('none');
    expect(output.instruction).toContain('openissue-grill-me');
    expect(output.instruction).toContain('openspec new change billing-integration');
    expect(output.instruction).toContain('--from-interview');
    expect(output.instruction).toContain('结束访谈并生成任务');

    expect(
      await readFile(path.join(anchor.root, 'openissue', 'issues', 'OI-20260101-AAAA.md'), 'utf8'),
    ).toBe(issueBefore);
    expect((await readdir(path.join(anchor.root, 'openspec', 'changes'))).sort()).toEqual(
      changesBefore,
    );

    const human = runCli(['start', 'OI-20260101-AAAA'], {
      cwd: anchor.root,
      env: env(anchor),
    });
    expect(human.status, human.stderr).toBe(0);
    expect(human.stdout).toContain('Billing integration');
    expect(human.stdout).toContain('billing-integration');
    expect(human.stdout).toContain('openissue-grill-me');
  });

  it('accepts an explicit change id and rejects an invalid one before writing', async () => {
    const anchor = await createAnchor({ id: 'demo', openspec: true });
    cleanup.push(anchor);
    await installSkills(anchor);
    await seed(anchor, 'OI-20260101-BBBB');

    const explicit = runCli(
      ['start', 'OI-20260101-BBBB', '--change', 'custom-entry', '--json'],
      { cwd: anchor.root, env: env(anchor) },
    );
    expect(explicit.status, explicit.stderr).toBe(0);
    const explicitOutput: unknown = JSON.parse(explicit.stdout);
    if (!isRecord(explicitOutput) || typeof explicitOutput.suggested_change_id !== 'string') {
      throw new Error('invalid start output');
    }
    expect(explicitOutput.suggested_change_id).toBe('custom-entry');

    await createActiveChange(anchor, 'taken-change');
    const conflict = runCli(
      ['start', 'OI-20260101-BBBB', '--change', 'taken-change', '--json'],
      { cwd: anchor.root, env: env(anchor) },
    );
    expect(conflict.status).not.toBe(0);
    expect(conflict.stderr).toContain('已存在');

    const invalid = runCli(
      ['start', 'OI-20260101-BBBB', '--change', 'Bad_ID', '--json'],
      { cwd: anchor.root, env: env(anchor) },
    );
    expect(invalid.status).not.toBe(0);
    expect(invalid.stderr).toContain('变更标识');
    expect((await readIssue(anchor, 'OI-20260101-BBBB')).proposals).toEqual([]);
  });

  it('prompts to install the interview skill when it is missing', async () => {
    const anchor = await createAnchor({ id: 'demo', openspec: true });
    cleanup.push(anchor);
    await seed(anchor, 'OI-20260101-CCCC');

    const result = runCli(['start', 'OI-20260101-CCCC', '--json'], {
      cwd: anchor.root,
      env: env(anchor),
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('openissue skills install');
    expect(result.stderr).toContain('openissue-grill-me');
    expect(await readdir(path.join(anchor.root, 'openspec', 'changes'))).toEqual([]);
  });
});

describe('handoff boundary', () => {
  it('rejects direct creation and points to start', async () => {
    const anchor = await createAnchor({ id: 'demo', openspec: true });
    cleanup.push(anchor);
    await seed(anchor, 'OI-20260101-DDDD');

    const result = runCli(
      ['handoff', 'OI-20260101-DDDD', '--change', 'direct-change', '--yes', '--json'],
      { cwd: anchor.root, env: env(anchor) },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('openissue start OI-20260101-DDDD');
    expect((await readIssue(anchor, 'OI-20260101-DDDD')).proposals).toEqual([]);
    expect(await readdir(path.join(anchor.root, 'openspec', 'changes'))).toEqual([]);
  });

  it('links an interview draft and writes the x-openissue-interview marker', async () => {
    const anchor = await createAnchor({ id: 'demo', openspec: true });
    cleanup.push(anchor);
    await seed(anchor, 'OI-20260101-EEEE');
    const proposal = '# Existing\n\n保持原样。\n';
    await createActiveChange(anchor, 'interview-draft', proposal);

    const result = runCli(
      ['handoff', 'OI-20260101-EEEE', '--link', 'interview-draft', '--from-interview', '--json'],
      { cwd: anchor.root, env: env(anchor) },
    );
    expect(result.status, result.stderr).toBe(0);
    const parsed = await metadata(anchor, 'interview-draft');
    expect(parsed['x-openissue-issues']).toEqual(['OI-20260101-EEEE']);
    expect(parsed['x-openissue-interview']).toMatchObject({
      status: 'incomplete',
      issue: 'OI-20260101-EEEE',
    });
    expect(
      await readFile(
        path.join(anchor.root, 'openspec', 'changes', 'interview-draft', 'proposal.md'),
        'utf8',
      ),
    ).toBe(proposal);
    expect((await readIssue(anchor, 'OI-20260101-EEEE')).proposals).toHaveLength(1);

    const shown = runCli(['show', 'OI-20260101-EEEE'], {
      cwd: anchor.root,
      env: env(anchor),
    });
    expect(shown.status, shown.stderr).toBe(0);
    expect(shown.stdout).toContain('访谈未完成');
    expect(shown.stdout).toContain('interview-draft');
    expect(shown.stdout).toContain('openissue start OI-20260101-EEEE');

    const shownJson = runCli(['show', 'OI-20260101-EEEE', '--json'], {
      cwd: anchor.root,
      env: env(anchor),
    });
    const json = JSON.parse(shownJson.stdout) as {
      handoff: { interview_incomplete: boolean; resume_change_id?: string };
    };
    expect(json.handoff.interview_incomplete).toBe(true);
    expect(json.handoff.resume_change_id).toBe('interview-draft');
  });

  it('rejects an invalid change id before linking', async () => {
    const anchor = await createAnchor({ id: 'demo', openspec: true });
    cleanup.push(anchor);
    await seed(anchor, 'OI-20260101-FFFF');
    const result = runCli(
      ['handoff', 'OI-20260101-FFFF', '--link', '../escape', '--from-interview'],
      { cwd: anchor.root, env: env(anchor) },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('变更标识');
    expect((await readIssue(anchor, 'OI-20260101-FFFF')).proposals).toEqual([]);
  });

  it('warns that manual linking skips the interview', async () => {
    const anchor = await createAnchor({ id: 'demo', openspec: true });
    cleanup.push(anchor);
    await seed(anchor, 'OI-20260101-FFFF');
    await createActiveChange(anchor, 'manual-link');

    const result = runCli(['handoff', 'OI-20260101-FFFF', '--link', 'manual-link', '--json'], {
      cwd: anchor.root,
      env: env(anchor),
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toContain('跳过产品决策访谈');
    const parsed = await metadata(anchor, 'manual-link');
    expect(parsed['x-openissue-interview']).toBeUndefined();
  });
});

describe('interview resume, takeover, and discard', () => {
  it('resumes the same incomplete draft and does not create a second one', async () => {
    const anchor = await createAnchor({ id: 'demo', openspec: true });
    cleanup.push(anchor);
    await installSkills(anchor);
    await seed(anchor, 'OI-20260101-GGGG');
    await createDraftAndLink(anchor, 'OI-20260101-GGGG', 'resume-draft');
    const before = (await readdir(path.join(anchor.root, 'openspec', 'changes'))).sort();

    const result = runCli(['start', 'OI-20260101-GGGG', '--json'], {
      cwd: anchor.root,
      env: env(anchor),
    });
    expect(result.status, result.stderr).toBe(0);
    const output = JSON.parse(result.stdout) as {
      active_proposals: Array<{ id: string; interview_status: string }>;
      resume_change_id?: string;
      selection_required: boolean;
      instruction: string;
    };
    expect(output.active_proposals).toEqual([
      expect.objectContaining({ id: 'resume-draft', interview_status: 'incomplete' }),
    ]);
    expect(output.resume_change_id).toBe('resume-draft');
    expect(output.selection_required).toBe(false);
    expect(output.instruction).toContain('继续未完成草稿 resume-draft');
    expect((await readdir(path.join(anchor.root, 'openspec', 'changes'))).sort()).toEqual(before);
  });

  it('takes over one active proposal and asks for a choice when several exist', async () => {
    const anchor = await createAnchor({ id: 'demo', openspec: true });
    cleanup.push(anchor);
    await installSkills(anchor);
    await seed(anchor, 'OI-20260101-HHHH');
    await createActiveChange(anchor, 'active-one');
    await createActiveChange(anchor, 'active-two');
    expect(
      runCli(['handoff', 'OI-20260101-HHHH', '--link', 'active-one', '--from-interview'], {
        cwd: anchor.root,
        env: env(anchor),
      }).status,
    ).toBe(0);
    expect(
      runCli(['handoff', 'OI-20260101-HHHH', '--link', 'active-two', '--from-interview'], {
        cwd: anchor.root,
        env: env(anchor),
      }).status,
    ).toBe(0);

    const multiple = runCli(['start', 'OI-20260101-HHHH', '--json'], {
      cwd: anchor.root,
      env: env(anchor),
    });
    expect(multiple.status, multiple.stderr).toBe(0);
    const output = JSON.parse(multiple.stdout) as {
      active_proposals: unknown[];
      selection_required: boolean;
      instruction: string;
    };
    expect(output.active_proposals).toHaveLength(2);
    expect(output.selection_required).toBe(true);
    expect(output.instruction).toContain('active-one');
    expect(output.instruction).toContain('active-two');
    expect(output.instruction).toContain('选择');
  });

  it('takes over an already linked active proposal by adding the interview marker', async () => {
    const anchor = await createAnchor({ id: 'demo', openspec: true });
    cleanup.push(anchor);
    await installSkills(anchor);
    await seed(anchor, 'OI-20260101-HHHH');
    const proposal = '# Existing\n\n保留正文。\n';
    await createActiveChange(anchor, 'takeover-draft', proposal);
    expect(
      runCli(['handoff', 'OI-20260101-HHHH', '--link', 'takeover-draft', '--json'], {
        cwd: anchor.root,
        env: env(anchor),
      }).status,
    ).toBe(0);

    const started = runCli(['start', 'OI-20260101-HHHH', '--json'], {
      cwd: anchor.root,
      env: env(anchor),
    });
    expect(started.status, started.stderr).toBe(0);
    const output = JSON.parse(started.stdout) as {
      active_proposals: Array<{ id: string; interview_status: string }>;
      instruction: string;
    };
    expect(output.active_proposals).toEqual([
      expect.objectContaining({ id: 'takeover-draft', interview_status: 'none' }),
    ]);
    expect(output.instruction).toContain('接管活跃提案 takeover-draft');

    const linked = runCli(
      ['handoff', 'OI-20260101-HHHH', '--link', 'takeover-draft', '--from-interview', '--json'],
      { cwd: anchor.root, env: env(anchor) },
    );
    expect(linked.status, linked.stderr).toBe(0);
    expect((await readIssue(anchor, 'OI-20260101-HHHH')).proposals).toHaveLength(1);
    expect(
      await readFile(
        path.join(anchor.root, 'openspec', 'changes', 'takeover-draft', 'proposal.md'),
        'utf8',
      ),
    ).toBe(proposal);
    expect((await metadata(anchor, 'takeover-draft'))['x-openissue-interview']).toMatchObject({
      status: 'incomplete',
      issue: 'OI-20260101-HHHH',
    });
  });

  it('never takes over archived proposals and reports missing links', async () => {
    const anchor = await createAnchor({ id: 'demo', openspec: true });
    cleanup.push(anchor);
    await installSkills(anchor);
    await seed(anchor, 'OI-20260101-IIII', {
      title: 'Archived draft',
      proposals: [
        {
          id: 'archived-draft',
          path: 'openspec/changes/archived-draft',
          created_at: '2026-01-01T00:00:00.000Z',
          snapshot_hash: contentHash('Archived draft', '账单接入需要先确认鉴权'),
        },
        {
          id: 'missing-draft',
          path: 'openspec/changes/missing-draft',
          created_at: '2026-01-01T00:00:00.000Z',
          snapshot_hash: contentHash('Archived draft', '账单接入需要先确认鉴权'),
        },
      ],
    });
    await createActiveChange(anchor, 'archived-draft');
    await archiveChange(anchor, 'archived-draft');

    const result = runCli(['start', 'OI-20260101-IIII', '--json'], {
      cwd: anchor.root,
      env: env(anchor),
    });
    expect(result.status, result.stderr).toBe(0);
    const output = JSON.parse(result.stdout) as {
      active_proposals: unknown[];
      archived_proposals: Array<{ id: string }>;
      missing_proposals: Array<{ id: string }>;
      instruction: string;
    };
    expect(output.active_proposals).toEqual([]);
    expect(output.suggested_change_id).toBe('archived-draft');
    expect(output.archived_proposals).toEqual([expect.objectContaining({ id: 'archived-draft' })]);
    expect(output.missing_proposals).toEqual([expect.objectContaining({ id: 'missing-draft' })]);
    expect(output.instruction).toContain('归档提案不能被接管');
  });

  it('requires a second confirmation before discarding and rolls back on cancellation', async () => {
    const anchor = await createAnchor({ id: 'demo', openspec: true });
    cleanup.push(anchor);
    await installSkills(anchor);
    await seed(anchor, 'OI-20260101-JJJJ');
    await createDraftAndLink(anchor, 'OI-20260101-JJJJ', 'discard-draft');

    const cancelled = runCli(['start', 'OI-20260101-JJJJ', '--discard', 'discard-draft'], {
      cwd: anchor.root,
      env: env(anchor),
    });
    expect(cancelled.status).not.toBe(0);
    expect(cancelled.stderr).toContain('二次确认');
    await access(path.join(anchor.root, 'openspec', 'changes', 'discard-draft', 'README.md'));
    expect((await readIssue(anchor, 'OI-20260101-JJJJ')).proposals).toHaveLength(1);

    const discarded = runCli(
      ['start', 'OI-20260101-JJJJ', '--discard', 'discard-draft', '--yes', '--json'],
      { cwd: anchor.root, env: env(anchor) },
    );
    expect(discarded.status, discarded.stderr).toBe(0);
    await expect(
      access(path.join(anchor.root, 'openspec', 'changes', 'discard-draft')),
    ).rejects.toThrow();
    expect((await readIssue(anchor, 'OI-20260101-JJJJ')).proposals).toEqual([]);
    expect((await readIssue(anchor, 'OI-20260101-JJJJ')).status).toBe('open');
  });

  it('reports unknown interview state instead of crashing or promising completion', async () => {
    const anchor = await createAnchor({ id: 'demo', openspec: true });
    cleanup.push(anchor);
    await seed(anchor, 'OI-20260101-KKKK', {
      proposals: [
        {
          id: 'broken-metadata',
          path: 'openspec/changes/broken-metadata',
          created_at: '2026-01-01T00:00:00.000Z',
          snapshot_hash: contentHash('接入第三方账单', '账单接入需要先确认鉴权'),
        },
      ],
    });
    const dir = path.join(anchor.root, 'openspec', 'changes', 'broken-metadata');
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, '.openspec.yaml'), 'schema: [broken\n', 'utf8');

    const shown = runCli(['show', 'OI-20260101-KKKK'], {
      cwd: anchor.root,
      env: env(anchor),
    });
    expect(shown.status, shown.stderr).toBe(0);
    expect(shown.stdout).toContain('访谈状态未知');
    expect(shown.stdout).not.toContain('访谈已完成');
    expect((await readIssue(anchor, 'OI-20260101-KKKK')).status).toBe('open');
  });

  it('rejects starting from a closed issue', async () => {
    const anchor = await createAnchor({ id: 'demo', openspec: true });
    cleanup.push(anchor);
    await installSkills(anchor);
    await seed(anchor, 'OI-20260101-LLLL', {
      status: 'closed',
      close: { reason: 'wontdo', note: '不做了', closed_at: '2026-01-02T00:00:00.000Z' },
    });
    const result = runCli(['start', 'OI-20260101-LLLL'], {
      cwd: anchor.root,
      env: env(anchor),
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('已关闭');
  });
});
