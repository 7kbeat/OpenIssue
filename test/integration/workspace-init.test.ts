import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import YAML from 'yaml';
import {
  createOpenspecSkeleton,
  createTempDir,
  issueFixture,
  runCli,
  runGit,
  runOpenspec,
  type TempDir,
} from '../helpers/fixtures.js';

const cleanup: TempDir[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((item) => item.cleanup()));
});

interface InitReport {
  mode: string;
  status: string;
  workspace_root: string;
  anchor_root?: string;
  product?: { id: string; name: string };
  code_root?: string;
  spec_root?: string;
  pointer?: { path: string; reused: boolean; anchor: string; product: string };
  candidates?: {
    anchors: Array<{ path: string; kind: string; store_pointer?: string }>;
    members: Array<{ path: string; preselected: boolean; conflict?: string }>;
    store_pointers: Array<{ path: string; store: string }>;
  };
  members: Array<{ id: string; path: string; status: string; reason?: string }>;
  phases: Array<{ id: string; status: string; message?: string }>;
  warnings: string[];
  next: string[];
}

function cliEnv(root: TempDir, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    OPENISSUE_HOME: path.join(root.root, '.home'),
    OPENISSUE_AUTHOR: '测试作者',
    ...extra,
  };
}

async function initAt(
  root: TempDir,
  args: string[],
  extraEnv: NodeJS.ProcessEnv = {},
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return runCli(['init', ...args], { cwd: root.root, env: cliEnv(root, extraEnv) });
}

function parseReport(result: { stdout: string }): InitReport {
  const start = result.stdout.indexOf('{');
  return JSON.parse(result.stdout.slice(start)) as InitReport;
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function writeAnchor(
  root: string,
  options: { id?: string; name?: string; openspec?: boolean; members?: Array<{ id: string }> } = {},
): Promise<void> {
  const id = options.id ?? 'demo';
  await mkdir(path.join(root, 'openissue', 'issues'), { recursive: true });
  await writeFile(
    path.join(root, 'openissue', 'product.yaml'),
    YAML.stringify({
      id,
      name: options.name ?? 'Demo Product',
      focus: '',
      focus_updated_at: null,
      members: options.members ?? [],
    }),
    'utf8',
  );
  if (options.openspec !== false) await createOpenspecSkeleton(root);
}

async function writeStoreMetadata(root: string, id: string): Promise<void> {
  await mkdir(path.join(root, '.openspec-store'), { recursive: true });
  await writeFile(
    path.join(root, '.openspec-store', 'store.yaml'),
    YAML.stringify({ version: 1, id }),
    'utf8',
  );
}

async function writeStorePointer(root: string, store: string): Promise<void> {
  await mkdir(path.join(root, 'openspec'), { recursive: true });
  await writeFile(path.join(root, 'openspec', 'config.yaml'), `store: ${store}\n`, 'utf8');
}

async function createGitRepo(root: string): Promise<void> {
  await mkdir(root, { recursive: true });
  runGit(root, ['init']);
}

async function seedIssue(
  anchorRoot: string,
  id = 'OI-20260101-AAAA',
  title = '锚点中的需求',
  product = 'demo',
): Promise<void> {
  await writeFile(
    path.join(anchorRoot, 'openissue', 'issues', `${id}.md`),
    issueFixture(
      {
        id,
        title,
        status: 'open',
        product,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
        author: '测试作者',
        source: 'cli',
      },
      '描述',
    ),
    'utf8',
  );
}

function readPointer(root: string): Record<string, unknown> {
  const content = readFileSync(path.join(root, '.openissue-workspace.yaml'), 'utf8');
  return YAML.parse(content) as Record<string, unknown>;
}

function countManagedSections(content: string): number {
  return content.split('<!-- OPENISSUE:START -->').length - 1;
}

function pathWithout(command: string): string {
  const entries = (process.env.PATH ?? '').split(path.delimiter);
  return entries
    .filter((entry) => {
      if (!entry) return false;
      const names =
        process.platform === 'win32'
          ? [`${command}.cmd`, `${command}.exe`, command]
          : [command];
      return !names.some((name) => existsSync(path.join(entry, name)));
    })
    .join(path.delimiter);
}

function runBoardAndStop(cwd: string, env: NodeJS.ProcessEnv): Promise<string> {
  const tsxCli = path.resolve('node_modules', 'tsx', 'dist', 'cli.mjs');
  const cli = path.resolve('src', 'cli.ts');
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  const child = spawn(process.execPath, [tsxCli, cli, 'board', '--port', '0', '--no-open'], {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  let stopping = false;
  const onData = (chunk: Buffer | string): void => {
    output += chunk.toString();
    if (!stopping && output.includes('看板已启动')) {
      stopping = true;
      child.kill();
    }
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  child.once('error', reject);
  child.once('close', () => resolve(output));
  return promise;
}

describe('workspace pointer and root resolution', () => {
  it('writes a lightweight pointer and resolves list, start, and board from the root', async () => {
    const workspace = await createTempDir('openissue-ws-');
    cleanup.push(workspace);
    const spec = path.join(workspace.root, 'spec');
    await writeAnchor(spec);
    await seedIssue(spec);
    await createGitRepo(path.join(workspace.root, 'code'));

    const initialized = await initAt(workspace, [
      '--anchor',
      'spec',
      '--yes',
      '--skills',
      'none',
      '--no-members',
      '--json',
    ]);
    expect(initialized.status, initialized.stderr).toBe(0);
    const report = parseReport(initialized);
    expect(report.status).toBe('success');
    expect(report.anchor_root).toBe(spec);

    const pointer = readPointer(workspace.root);
    expect(Object.keys(pointer).sort()).toEqual(['anchor', 'product', 'version']);
    expect(pointer.version).toBe(1);
    expect(pointer.product).toBe('demo');
    expect(path.isAbsolute(String(pointer.anchor))).toBe(false);
    expect(String(pointer.anchor)).not.toContain('\\');
    expect(path.resolve(workspace.root, String(pointer.anchor))).toBe(spec);
    expect(await exists(path.join(workspace.root, 'openissue'))).toBe(false);

    const listed = runCli(['list', '--json'], {
      cwd: workspace.root,
      env: cliEnv(workspace),
    });
    expect(listed.status, listed.stderr).toBe(0);
    expect(listed.stdout).toContain('OI-20260101-AAAA');

    const installed = runCli(['skills', 'install', '--tool', 'agents'], {
      cwd: workspace.root,
      env: cliEnv(workspace),
    });
    expect(installed.status, installed.stderr).toBe(0);
    const started = runCli(['start', 'OI-20260101-AAAA', '--json'], {
      cwd: workspace.root,
      env: cliEnv(workspace),
    });
    expect(started.status, started.stderr).toBe(0);
    expect(started.stdout).toContain('OI-20260101-AAAA');

    const board = await runBoardAndStop(workspace.root, cliEnv(workspace));
    expect(board).toContain('看板已启动');
  });

  it('prefers a valid pointer over other anchors and is idempotent on re-init', async () => {
    const workspace = await createTempDir('openissue-ws-');
    cleanup.push(workspace);
    const chosen = path.join(workspace.root, 'chosen');
    const other = path.join(workspace.root, 'other');
    await writeAnchor(chosen, { id: 'chosen' });
    await writeAnchor(other, { id: 'other' });
    await seedIssue(chosen, 'OI-20260101-CHOS', '选中的需求', 'chosen');
    await seedIssue(other, 'OI-20260101-OTHR', '另一个需求', 'other');

    const first = await initAt(workspace, [
      '--anchor',
      'chosen',
      '--yes',
      '--skills',
      'none',
      '--no-members',
      '--json',
    ]);
    expect(first.status, first.stderr).toBe(0);
    const pointerBefore = readPointer(workspace.root);
    const agentsBefore = await readFile(path.join(workspace.root, 'AGENTS.md'), 'utf8');

    const listed = runCli(['list', '--json'], {
      cwd: workspace.root,
      env: cliEnv(workspace),
    });
    expect(listed.status, listed.stderr).toBe(0);
    expect(listed.stdout).toContain('OI-20260101-CHOS');
    expect(listed.stdout).not.toContain('OI-20260101-OTHR');

    const again = await initAt(workspace, [
      '--yes',
      '--skills',
      'none',
      '--no-members',
      '--json',
    ]);
    expect(again.status, again.stderr).toBe(0);
    const report = parseReport(again);
    expect(report.pointer?.reused).toBe(true);
    expect(readPointer(workspace.root)).toEqual(pointerBefore);
    expect(await readFile(path.join(workspace.root, 'AGENTS.md'), 'utf8')).toBe(agentsBefore);
    expect(countManagedSections(agentsBefore)).toBe(1);
  });

  it('reports an invalid pointer and repairs it only with an explicit anchor', async () => {
    const workspace = await createTempDir('openissue-ws-');
    cleanup.push(workspace);
    const spec = path.join(workspace.root, 'spec');
    await writeAnchor(spec);
    await writeFile(
      path.join(workspace.root, '.openissue-workspace.yaml'),
      YAML.stringify({ version: 1, product: 'demo', anchor: 'missing' }),
      'utf8',
    );

    const broken = runCli(['list', '--json'], {
      cwd: workspace.root,
      env: cliEnv(workspace),
    });
    expect(broken.status).not.toBe(0);
    expect(broken.stderr).toContain('锚点');
    expect(broken.stderr).toContain('--anchor');

    const repaired = await initAt(workspace, [
      '--rescan',
      '--anchor',
      'spec',
      '--yes',
      '--skills',
      'none',
      '--no-members',
      '--json',
    ]);
    expect(repaired.status, repaired.stderr).toBe(0);
    const pointer = readPointer(workspace.root);
    expect(path.resolve(workspace.root, String(pointer.anchor))).toBe(spec);
  });

  it('reports a pointer write failure without deleting the anchor', async () => {
    const workspace = await createTempDir('openissue-ws-');
    cleanup.push(workspace);
    const spec = path.join(workspace.root, 'spec');
    await writeAnchor(spec);
    await mkdir(path.join(workspace.root, '.openissue-workspace.yaml'));

    const result = await initAt(workspace, [
      '--rescan',
      '--anchor',
      'spec',
      '--yes',
      '--skills',
      'none',
      '--no-members',
      '--json',
    ]);
    expect(result.status).not.toBe(0);
    const report = parseReport(result);
    expect(report.status).not.toBe('success');
    expect(report.phases.some((phase) => phase.status === 'failed')).toBe(true);
    expect(await exists(path.join(spec, 'openissue', 'product.yaml'))).toBe(true);
    expect(result.stdout).toContain('指针');
  });
});

describe('anchor discovery and single-repo classification', () => {
  it('reuses a unique OpenIssue anchor and excludes store pointer repositories', async () => {
    const workspace = await createTempDir('openissue-ws-');
    cleanup.push(workspace);
    const spec = path.join(workspace.root, 'spec');
    const pointerRepo = path.join(workspace.root, 'pointer');
    await writeAnchor(spec);
    await writeStorePointer(pointerRepo, 'demo');

    const result = await initAt(workspace, [
      '--yes',
      '--skills',
      'none',
      '--no-members',
      '--json',
    ]);
    expect(result.status, result.stderr).toBe(0);
    const report = parseReport(result);
    expect(report.anchor_root).toBe(spec);
    expect(report.candidates?.anchors).toHaveLength(1);
    expect(report.candidates?.anchors[0]!.path).toBe(spec);
    expect(await exists(path.join(pointerRepo, 'openissue'))).toBe(false);
    expect(path.resolve(workspace.root, String(readPointer(workspace.root).anchor))).toBe(spec);
  });

  it('excludes three store pointer repositories from the anchor list', async () => {
    const workspace = await createTempDir('openissue-ws-');
    cleanup.push(workspace);
    const spec = path.join(workspace.root, 'spec');
    await writeAnchor(spec);
    for (const name of ['store-a', 'store-b', 'store-c']) {
      await writeStorePointer(path.join(workspace.root, name), name);
    }

    const result = await initAt(workspace, [
      '--yes',
      '--skills',
      'none',
      '--no-members',
      '--json',
    ]);
    expect(result.status, result.stderr).toBe(0);
    const report = parseReport(result);
    expect(report.candidates?.anchors.map((candidate) => candidate.path)).toEqual([spec]);
    expect(report.candidates?.store_pointers.map((candidate) => candidate.store)).toEqual([
      'store-a',
      'store-b',
      'store-c',
    ]);
  });

  it('requires confirmation before adding OpenIssue to an OpenSpec-only candidate', async () => {
    const workspace = await createTempDir('openissue-ws-');
    cleanup.push(workspace);
    const spec = path.join(workspace.root, 'spec');
    await createOpenspecSkeleton(spec);
    await writeStorePointer(path.join(workspace.root, 'pointer'), 'demo');

    const unconfirmed = await initAt(workspace, [
      '--skills',
      'none',
      '--no-members',
    ]);
    expect(unconfirmed.status).not.toBe(0);
    expect(unconfirmed.stderr).toContain('确认');
    expect(await exists(path.join(spec, 'openissue'))).toBe(false);

    const confirmed = await initAt(workspace, [
      '--yes',
      '--skills',
      'none',
      '--no-members',
      '--json',
    ]);
    expect(confirmed.status, confirmed.stderr).toBe(0);
    expect(await exists(path.join(spec, 'openissue', 'product.yaml'))).toBe(true);
  });

  it('requires an explicit anchor when multiple candidates exist', async () => {
    const workspace = await createTempDir('openissue-ws-');
    cleanup.push(workspace);
    await writeAnchor(path.join(workspace.root, 'alpha'), { id: 'alpha' });
    await writeAnchor(path.join(workspace.root, 'beta'), { id: 'beta' });

    const ambiguous = await initAt(workspace, [
      '--yes',
      '--skills',
      'none',
      '--no-members',
    ]);
    expect(ambiguous.status).not.toBe(0);
    expect(ambiguous.stderr).toContain('多个');
    expect(ambiguous.stderr).toContain('--anchor');
    expect(await exists(path.join(workspace.root, '.openissue-workspace.yaml'))).toBe(false);

    const selected = await initAt(workspace, [
      '--anchor',
      'beta',
      '--yes',
      '--skills',
      'none',
      '--no-members',
      '--json',
    ]);
    expect(selected.status, selected.stderr).toBe(0);
    expect(parseReport(selected).product?.id).toBe('beta');
  });

  it('initializes a single Git repository in place without a pointer or root index', async () => {
    const repo = await createTempDir('openissue-single-');
    cleanup.push(repo);
    await createGitRepo(repo.root);
    await createOpenspecSkeleton(repo.root);

    const result = await initAt(repo, [
      '--id',
      'demo',
      '--name',
      'Demo',
      '--yes',
      '--skills',
      'none',
      '--json',
    ]);
    expect(result.status, result.stderr).toBe(0);
    expect(parseReport(result).mode).toBe('single-repo');
    expect(await exists(path.join(repo.root, 'openissue', 'product.yaml'))).toBe(true);
    expect(await exists(path.join(repo.root, '.openissue-workspace.yaml'))).toBe(false);
    expect(await exists(path.join(repo.root, 'AGENTS.md'))).toBe(false);
  });

  it('rejects nested initialization inside a Git repository subdirectory', async () => {
    const repo = await createTempDir('openissue-single-');
    cleanup.push(repo);
    await createGitRepo(repo.root);
    const nested = path.join(repo.root, 'src', 'nested');
    await mkdir(nested, { recursive: true });

    const result = runCli(['init', '--id', 'demo', '--skills', 'none'], {
      cwd: nested,
      env: cliEnv(repo),
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('仓根');
    expect(await exists(path.join(nested, 'openissue'))).toBe(false);
  });
});

describe('member candidates', () => {
  async function memberFixture(): Promise<{
    workspace: TempDir;
    spec: string;
    member: string;
    other: string;
  }> {
    const workspace = await createTempDir('openissue-ws-');
    cleanup.push(workspace);
    const spec = path.join(workspace.root, 'spec');
    await writeAnchor(spec);
    await writeStoreMetadata(spec, 'demo');
    const member = path.join(workspace.root, 'member');
    const other = path.join(workspace.root, 'other');
    await createGitRepo(member);
    await createGitRepo(other);
    await writeStorePointer(member, 'demo');
    return { workspace, spec, member, other };
  }

  it('preselects store-matching members and leaves other Git repositories untouched', async () => {
    const fixture = await memberFixture();
    const result = await initAt(fixture.workspace, [
      '--anchor',
      'spec',
      '--yes',
      '--skills',
      'none',
      '--json',
    ]);
    expect(result.status, result.stderr).toBe(0);
    const report = parseReport(result);
    expect(report.members.find((member) => member.path === fixture.member)).toMatchObject({
      id: 'member',
      status: 'registered',
    });
    expect(report.members.find((member) => member.path === fixture.other)).toBeUndefined();
    const pointer = YAML.parse(
      await readFile(path.join(fixture.member, 'openissue-project.yaml'), 'utf8'),
    ) as { products: Array<{ id: string; anchor?: string }> };
    expect(pointer.products[0]!.id).toBe('demo');
    expect(path.resolve(fixture.member, pointer.products[0]!.anchor!)).toBe(fixture.spec);
    await expect(access(path.join(fixture.other, 'openissue-project.yaml'))).rejects.toThrow();
    const product = YAML.parse(
      await readFile(path.join(fixture.spec, 'openissue', 'product.yaml'), 'utf8'),
    ) as { members: Array<{ id: string }> };
    expect(product.members.map((member) => member.id)).toContain('member');
  });

  it('registers an explicitly selected optional member', async () => {
    const fixture = await memberFixture();
    const result = await initAt(fixture.workspace, [
      '--anchor',
      'spec',
      '--yes',
      '--skills',
      'none',
      '--member',
      fixture.other,
      '--json',
    ]);
    expect(result.status, result.stderr).toBe(0);
    const pointer = YAML.parse(
      await readFile(path.join(fixture.other, 'openissue-project.yaml'), 'utf8'),
    ) as { products: Array<{ id: string }> };
    expect(pointer.products[0]!.id).toBe('demo');
  });

  it('marks conflicting members and does not overwrite their product pointer', async () => {
    const fixture = await memberFixture();
    const conflictPointer = YAML.stringify({
      products: [{ id: 'other-product', anchor: '/tmp/other-anchor' }],
    });
    await writeFile(path.join(fixture.member, 'openissue-project.yaml'), conflictPointer, 'utf8');

    const result = await initAt(fixture.workspace, [
      '--anchor',
      'spec',
      '--yes',
      '--skills',
      'none',
      '--json',
    ]);
    expect(result.status, result.stderr).toBe(0);
    const report = parseReport(result);
    expect(report.members.find((member) => member.path === fixture.member)?.status).toBe(
      'conflict',
    );
    expect(await readFile(path.join(fixture.member, 'openissue-project.yaml'), 'utf8')).toBe(
      conflictPointer,
    );
    const product = YAML.parse(
      await readFile(path.join(fixture.spec, 'openissue', 'product.yaml'), 'utf8'),
    ) as { members: Array<{ id: string }> };
    expect(product.members).toHaveLength(0);
  });

  it('requires confirmation before writing member pointers', async () => {
    const fixture = await memberFixture();
    const result = await initAt(fixture.workspace, [
      '--anchor',
      'spec',
      '--skills',
      'none',
    ]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('--yes');
    await expect(access(path.join(fixture.member, 'openissue-project.yaml'))).rejects.toThrow();
    const product = YAML.parse(
      await readFile(path.join(fixture.spec, 'openissue', 'product.yaml'), 'utf8'),
    ) as { members: Array<{ id: string }> };
    expect(product.members).toHaveLength(0);
  });

  it('reports partial member registration when one write fails', async () => {
    const fixture = await memberFixture();
    const broken = path.join(fixture.workspace.root, 'broken');
    await createGitRepo(broken);
    await writeStorePointer(broken, 'demo');
    await mkdir(path.join(broken, 'openissue-project.yaml'));

    const result = await initAt(fixture.workspace, [
      '--anchor',
      'spec',
      '--yes',
      '--skills',
      'none',
      '--member',
      fixture.member,
      '--member',
      broken,
      '--json',
    ]);
    expect(result.status).not.toBe(0);
    const report = parseReport(result);
    expect(report.status).not.toBe('success');
    expect(report.members.find((member) => member.path === fixture.member)?.status).toBe(
      'registered',
    );
    expect(report.members.find((member) => member.path === broken)?.status).toBe('failed');
    expect(await exists(path.join(fixture.member, 'openissue-project.yaml'))).toBe(true);
    expect((await readdir(broken)).includes('openissue-project.yaml')).toBe(true);
    const product = YAML.parse(
      await readFile(path.join(fixture.spec, 'openissue', 'product.yaml'), 'utf8'),
    ) as { members: Array<{ id: string }> };
    expect(product.members.map((member) => member.id)).toEqual(['member']);
  });
});

describe('new project scaffold', () => {
  async function newProject(
    root: TempDir,
    name = 'My Cool_Project',
    extraArgs: string[] = [],
    extraEnv: NodeJS.ProcessEnv = {},
  ) {
    return initAt(
      root,
      [
        '--new',
        '--name',
        name,
        '--yes',
        '--skills',
        'none',
        '--json',
        ...extraArgs,
      ],
      extraEnv,
    );
  }

  it('normalizes the name, creates the two repositories, and never creates a commit', async () => {
    const workspace = await createTempDir('openissue-new-');
    cleanup.push(workspace);
    const result = await newProject(workspace);
    expect(result.status, result.stderr).toBe(0);
    const report = parseReport(result);
    expect(report.mode).toBe('new-project');
    expect(report.product).toMatchObject({ id: 'my-cool-project', name: 'My Cool_Project' });

    const code = path.join(workspace.root, 'my-cool-project');
    const spec = path.join(workspace.root, 'my-cool-project-spec');
    expect(await exists(path.join(code, 'README.md'))).toBe(true);
    expect(await exists(path.join(code, '.gitignore'))).toBe(true);
    expect(await exists(path.join(code, 'AGENTS.md'))).toBe(true);
    expect(await exists(path.join(code, 'openissue-project.yaml'))).toBe(true);
    expect(await exists(path.join(code, '.git'))).toBe(true);
    expect(await exists(path.join(spec, 'openissue', 'product.yaml'))).toBe(true);
    expect(await exists(path.join(spec, 'openspec', 'config.yaml'))).toBe(true);
    expect(await exists(path.join(spec, 'README.md'))).toBe(true);
    expect(await exists(path.join(spec, 'AGENTS.md'))).toBe(true);
    expect(await exists(path.join(spec, '.git'))).toBe(true);
    expect(await exists(path.join(code, 'src'))).toBe(false);
    expect(await exists(path.join(workspace.root, '.openissue-workspace.yaml'))).toBe(true);

    const log = spawnSync('git', ['rev-list', '--count', 'HEAD'], {
      cwd: code,
      encoding: 'utf8',
    });
    expect(log.status).not.toBe(0);
    expect(await readFile(path.join(code, 'AGENTS.md'), 'utf8')).toContain(
      '../my-cool-project-spec/AGENTS.md',
    );
    expect(report.next.join('\n')).toContain('git');
  });

  it('rejects non-English names and existing target directories before writing', async () => {
    const chinese = await createTempDir('openissue-new-');
    cleanup.push(chinese);
    const rejected = await newProject(chinese, '中文项目');
    expect(rejected.status).not.toBe(0);
    expect(rejected.stderr).toContain('英文');
    expect(await readdir(chinese.root)).toEqual([]);

    const conflict = await createTempDir('openissue-new-');
    cleanup.push(conflict);
    await mkdir(path.join(conflict.root, 'demo'));
    const blocked = await newProject(conflict, 'Demo');
    expect(blocked.status).not.toBe(0);
    expect(blocked.stderr).toContain('已存在');
    expect(await exists(path.join(conflict.root, 'demo-spec'))).toBe(false);
  });

  it('requires explicit selection for ordinary content and prompts for a name in an empty workspace', async () => {
    const ordinary = await createTempDir('openissue-new-');
    cleanup.push(ordinary);
    await writeFile(path.join(ordinary.root, 'notes.txt'), 'existing\n', 'utf8');
    const blocked = await initAt(ordinary, ['--yes', '--skills', 'none']);
    expect(blocked.status).not.toBe(0);
    expect(blocked.stderr).toContain('notes.txt');
    expect(blocked.stderr).toContain('--new');
    expect(await exists(path.join(ordinary.root, 'demo'))).toBe(false);

    const created = await newProject(ordinary, 'Demo');
    expect(created.status, created.stderr).toBe(0);
    expect(await exists(path.join(ordinary.root, 'demo', 'README.md'))).toBe(true);

    const empty = await createTempDir('openissue-new-');
    cleanup.push(empty);
    await mkdir(path.join(empty.root, '.agents', 'skills'), { recursive: true });
    const missingName = await initAt(empty, ['--yes', '--skills', 'none']);
    expect(missingName.status).not.toBe(0);
    expect(missingName.stderr).toContain('--name');
    expect(await exists(path.join(empty.root, '.openissue-workspace.yaml'))).toBe(false);
  });

  it('stores relative pointer paths with POSIX separators', async () => {
    const workspace = await createTempDir('openissue-new-');
    cleanup.push(workspace);
    const result = await newProject(workspace, 'Path Case');
    expect(result.status, result.stderr).toBe(0);
    const pointer = readPointer(workspace.root);
    expect(pointer.anchor).toBe('path-case-spec');
    expect(path.resolve(workspace.root, String(pointer.anchor))).toBe(
      path.join(workspace.root, 'path-case-spec'),
    );
  });
});

describe('OpenSpec, skills, and AGENTS entry points', () => {
  async function newProject(
    root: TempDir,
    extraArgs: string[] = [],
    extraEnv: NodeJS.ProcessEnv = {},
  ) {
    return initAt(
      root,
      ['--new', '--name', 'Demo', '--yes', '--json', ...extraArgs],
      extraEnv,
    );
  }

  it('initializes OpenSpec, promotes agent skills to the root, and writes the managed index', async () => {
    const workspace = await createTempDir('openissue-new-');
    cleanup.push(workspace);
    const result = await newProject(workspace, ['--skills', 'agents']);
    expect(result.status, result.stderr).toBe(0);

    const rootSkills = path.join(workspace.root, '.agents', 'skills');
    expect(await exists(path.join(rootSkills, 'openissue-capture', 'SKILL.md'))).toBe(true);
    expect(await exists(path.join(rootSkills, 'openspec-propose', 'SKILL.md'))).toBe(true);
    expect(await exists(path.join(rootSkills, 'openspec-explore', 'SKILL.md'))).toBe(true);
    expect(await exists(path.join(workspace.root, 'demo-spec', '.agents', 'skills'))).toBe(false);

    const rootAgents = await readFile(path.join(workspace.root, 'AGENTS.md'), 'utf8');
    expect(countManagedSections(rootAgents)).toBe(1);
    expect(rootAgents).toContain('demo/AGENTS.md');
    expect(rootAgents).toContain('demo-spec/AGENTS.md');
    expect(await readFile(path.join(workspace.root, 'demo-spec', 'AGENTS.md'), 'utf8')).toContain(
      'openspec/',
    );
    expect(await readFile(path.join(workspace.root, 'demo', 'AGENTS.md'), 'utf8')).not.toMatch(
      /TypeScript|React|Vue|脚手架/,
    );

    const validated = runOpenspec(path.join(workspace.root, 'demo-spec'), [
      'validate',
      '--all',
      '--strict',
    ]);
    expect(validated.status, validated.stderr).toBe(0);
    const skills = runCli(['skills', 'status', '--json'], {
      cwd: workspace.root,
      env: cliEnv(workspace),
    });
    expect(skills.status, skills.stderr).toBe(0);
    const status = JSON.parse(skills.stdout) as {
      tools: Array<{ skills: Array<{ state: string }> }>;
    };
    expect(status.tools[0]!.skills.every((skill) => skill.state === 'current')).toBe(true);
  });

  it('preserves manual root AGENTS content and appends one managed section', async () => {
    const workspace = await createTempDir('openissue-new-');
    cleanup.push(workspace);
    const manual = '# Workspace\n\n人工说明。\n';
    await writeFile(path.join(workspace.root, 'AGENTS.md'), manual, 'utf8');

    const result = await newProject(workspace, ['--skills', 'none']);
    expect(result.status, result.stderr).toBe(0);
    const content = await readFile(path.join(workspace.root, 'AGENTS.md'), 'utf8');
    expect(content.startsWith(manual)).toBe(true);
    expect(countManagedSections(content)).toBe(1);
  });

  it('skips OpenIssue skills with none and rejects other tool targets before writing', async () => {
    const skipped = await createTempDir('openissue-new-');
    cleanup.push(skipped);
    const none = await newProject(skipped, ['--skills', 'none']);
    expect(none.status, none.stderr).toBe(0);
    expect(await exists(path.join(skipped.root, '.agents', 'skills', 'openissue-capture'))).toBe(
      false,
    );

    const rejected = await createTempDir('openissue-new-');
    cleanup.push(rejected);
    const result = await newProject(rejected, ['--skills', 'claude']);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('openissue skills install --tool claude');
    expect(await exists(path.join(rejected.root, 'demo'))).toBe(false);
  });

  it('still creates the project when the OpenSpec CLI is unavailable', async () => {
    const workspace = await createTempDir('openissue-new-');
    cleanup.push(workspace);
    const result = await newProject(
      workspace,
      ['--skills', 'none'],
      { PATH: pathWithout('openspec') },
    );
    expect(result.status).not.toBe(0);
    const report = parseReport(result);
    expect(report.status).not.toBe('success');
    expect(report.warnings.join('\n')).toContain('OpenSpec');
    expect(await exists(path.join(workspace.root, 'demo', 'README.md'))).toBe(true);
    expect(await exists(path.join(workspace.root, 'demo-spec', 'openissue', 'product.yaml'))).toBe(
      true,
    );
    expect(await exists(path.join(workspace.root, 'demo-spec', 'openspec'))).toBe(false);
    const specAgents = await readFile(path.join(workspace.root, 'demo-spec', 'AGENTS.md'), 'utf8');
    expect(specAgents).not.toContain('OpenSpec 已就绪');
  });

  it('preserves the spec copy when promoted skills conflict', async () => {
    const workspace = await createTempDir('openissue-new-');
    cleanup.push(workspace);
    const conflictFile = path.join(
      workspace.root,
      '.agents',
      'skills',
      'openspec-propose',
      'SKILL.md',
    );
    await mkdir(path.dirname(conflictFile), { recursive: true });
    await writeFile(conflictFile, 'user-owned skill\n', 'utf8');

    const result = await newProject(workspace, ['--skills', 'agents']);
    expect(result.status).not.toBe(0);
    const report = parseReport(result);
    expect(report.warnings.join('\n') + report.phases.map((phase) => phase.message).join('\n')).toContain(
      '冲突',
    );
    expect(await readFile(conflictFile, 'utf8')).toBe('user-owned skill\n');
    expect(
      await exists(
        path.join(workspace.root, 'demo-spec', '.agents', 'skills', 'openspec-propose', 'SKILL.md'),
      ),
    ).toBe(true);
  });

  it('does not link missing AGENTS targets from the root index', async () => {
    const workspace = await createTempDir('openissue-ws-');
    cleanup.push(workspace);
    const spec = path.join(workspace.root, 'spec');
    await writeAnchor(spec);
    const result = await initAt(workspace, [
      '--anchor',
      'spec',
      '--yes',
      '--skills',
      'none',
      '--no-members',
      '--json',
    ]);
    expect(result.status, result.stderr).toBe(0);
    const rootAgents = await readFile(path.join(workspace.root, 'AGENTS.md'), 'utf8');
    expect(rootAgents).not.toContain('spec/AGENTS.md');
    expect(rootAgents).toContain('尚无可用');
  });
});

describe('failure recovery and idempotence', () => {
  it('asks before adding OpenSpec to a single repository and honors no-openspec', async () => {
    const repo = await createTempDir('openissue-single-');
    cleanup.push(repo);
    await createGitRepo(repo.root);

    const unconfirmed = await initAt(repo, [
      '--id',
      'demo',
      '--name',
      'Demo',
      '--skills',
      'none',
    ]);
    expect(unconfirmed.status).not.toBe(0);
    expect(unconfirmed.stderr).toContain('--openspec');
    expect(await exists(path.join(repo.root, 'openissue'))).toBe(false);

    const declined = await initAt(repo, [
      '--id',
      'demo',
      '--name',
      'Demo',
      '--yes',
      '--no-openspec',
      '--skills',
      'none',
      '--json',
    ]);
    expect(declined.status, declined.stderr).toBe(0);
    expect(await exists(path.join(repo.root, 'openissue', 'product.yaml'))).toBe(true);
    expect(await exists(path.join(repo.root, 'openspec'))).toBe(false);
    expect(await exists(path.join(repo.root, '.openissue-workspace.yaml'))).toBe(false);
    expect(await exists(path.join(repo.root, 'AGENTS.md'))).toBe(false);
  });

  it('initializes a single repository that already has OpenSpec without a pointer', async () => {
    const repo = await createTempDir('openissue-single-');
    cleanup.push(repo);
    await createGitRepo(repo.root);
    await createOpenspecSkeleton(repo.root);
    const result = await initAt(repo, [
      '--id',
      'demo',
      '--name',
      'Demo',
      '--yes',
      '--skills',
      'none',
      '--json',
    ]);
    expect(result.status, result.stderr).toBe(0);
    expect(await exists(path.join(repo.root, 'openissue', 'product.yaml'))).toBe(true);
    expect(await exists(path.join(repo.root, '.openissue-workspace.yaml'))).toBe(false);
  });

  it('keeps created content when Git is unavailable and reports the failed phase', async () => {
    const workspace = await createTempDir('openissue-new-');
    cleanup.push(workspace);
    const result = await initAt(
      workspace,
      ['--new', '--name', 'Demo', '--yes', '--skills', 'none', '--json'],
      { PATH: pathWithout('git') },
    );
    expect(result.status).not.toBe(0);
    const report = parseReport(result);
    expect(report.phases.find((phase) => phase.id === 'git')?.status).toBe('failed');
    expect(await exists(path.join(workspace.root, 'demo', 'README.md'))).toBe(true);
    expect(await exists(path.join(workspace.root, 'demo-spec', 'openissue', 'product.yaml'))).toBe(
      true,
    );
    expect(await exists(path.join(workspace.root, 'demo', '.git'))).toBe(false);
    expect(report.next.join('\n')).toContain('git init');
  });

  it('resumes a partially created new project on retry without duplicating members', async () => {
    const workspace = await createTempDir('openissue-new-');
    cleanup.push(workspace);
    const first = await initAt(
      workspace,
      ['--new', '--name', 'Demo', '--yes', '--skills', 'none', '--json'],
      { PATH: pathWithout('openspec') },
    );
    expect(first.status).not.toBe(0);
    expect(await exists(path.join(workspace.root, 'demo-spec', 'openspec'))).toBe(false);

    const retry = await initAt(workspace, [
      '--new',
      '--name',
      'Demo',
      '--yes',
      '--skills',
      'none',
      '--json',
    ]);
    expect(retry.status, retry.stderr).toBe(0);
    expect(await exists(path.join(workspace.root, 'demo-spec', 'openspec', 'config.yaml'))).toBe(
      true,
    );
    expect(await exists(path.join(workspace.root, '.openissue-workspace.yaml'))).toBe(true);
    const product = YAML.parse(
      await readFile(path.join(workspace.root, 'demo-spec', 'openissue', 'product.yaml'), 'utf8'),
    ) as { members: Array<{ id: string }> };
    expect(product.members.map((member) => member.id)).toEqual(['demo']);
    const rootAgents = await readFile(path.join(workspace.root, 'AGENTS.md'), 'utf8');
    expect(countManagedSections(rootAgents)).toBe(1);
  });

  it('reuses the pointer on workspace re-init and reports success/failure phases', async () => {
    const workspace = await createTempDir('openissue-ws-');
    cleanup.push(workspace);
    const spec = path.join(workspace.root, 'spec');
    await writeAnchor(spec);
    const member = path.join(workspace.root, 'member');
    await createGitRepo(member);
    await writeStoreMetadata(spec, 'demo');
    await writeStorePointer(member, 'demo');

    const first = await initAt(workspace, [
      '--anchor',
      'spec',
      '--yes',
      '--skills',
      'none',
      '--json',
    ]);
    expect(first.status, first.stderr).toBe(0);
    const second = await initAt(workspace, [
      '--yes',
      '--skills',
      'none',
      '--json',
    ]);
    expect(second.status, second.stderr).toBe(0);
    const report = parseReport(second);
    expect(report.pointer?.reused).toBe(true);
    expect(report.phases.every((phase) => phase.status !== 'not-run' || phase.id !== 'anchor')).toBe(true);
    const product = YAML.parse(
      await readFile(path.join(spec, 'openissue', 'product.yaml'), 'utf8'),
    ) as { members: Array<{ id: string }> };
    expect(product.members.map((member) => member.id)).toEqual(['member']);
  });
});
