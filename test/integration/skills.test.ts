import { createHash } from 'node:crypto';
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { VERSION } from '../../src/core/version.js';
import {
  createOpenspecSkeleton,
  createTempDir,
  runCli,
  type TempDir,
} from '../helpers/fixtures.js';

const cleanup: TempDir[] = [];
const skillNames = [
  'openissue-capture',
  'openissue-grill-me',
  'openissue-handoff',
  'openissue-triage',
];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((item) => item.cleanup()));
});

function cliEnv(root: TempDir): NodeJS.ProcessEnv {
  return {
    OPENISSUE_HOME: path.join(root.root, '.home'),
    OPENISSUE_AUTHOR: '测试作者',
  };
}

async function run(root: TempDir, args: string[]) {
  return runCli(args, { cwd: root.root, env: cliEnv(root) });
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function readManifest(root: TempDir): Promise<{
  schema: number;
  generator: string;
  generator_version: string;
  skills: Record<string, { sha256: string }>;
}> {
  return JSON.parse(
    await readFile(path.join(root.root, '.agents', 'skills', '.openissue-skills.json'), 'utf8'),
  ) as {
    schema: number;
    generator: string;
    generator_version: string;
    skills: Record<string, { sha256: string }>;
  };
}

describe('bundled skills', () => {
  it('lists all bundled workflows and supported tools', async () => {
    const root = await createTempDir('openissue-skills-');
    cleanup.push(root);
    const result = await run(root, ['skills', 'list', '--json']);
    expect(result.status, result.stderr).toBe(0);
    const output = JSON.parse(result.stdout) as {
      skills: Array<{ name: string; description: string }>;
      tools: Array<{ id: string; directory: string; aliasOf?: string }>;
    };
    expect(output.skills.map((skill) => skill.name).sort()).toEqual(skillNames);
    expect(output.skills.every((skill) => skill.description.trim().length > 0)).toBe(true);
    expect(output.tools.some((tool) => tool.id === 'agents' && tool.directory === '.agents')).toBe(true);
    expect(output.tools.some((tool) => tool.id === 'codex' && tool.aliasOf === 'agents')).toBe(true);

    const capture = await readFile(path.resolve('skills', 'openissue-capture', 'SKILL.md'), 'utf8');
    expect(capture).toContain('openissue create');
    expect(capture).toContain('不要在本流程中实现');
    const handoff = await readFile(path.resolve('skills', 'openissue-handoff', 'SKILL.md'), 'utf8');
    expect(handoff).toContain('openissue handoff');
    expect(handoff).toContain('openissue confirm');
    expect(handoff).toContain('不伪造 OpenSpec');
    expect(handoff).not.toContain('openissue handoff <id> --change');

    const grill = await readFile(path.resolve('skills', 'openissue-grill-me', 'SKILL.md'), 'utf8');
    expect(grill).toContain('OpenIssue Grill-Me: User-Centered Product Decision Interview');
    expect(grill).toContain('## 1. Core Principles');
    expect(grill).toContain('### 1.2 Separate verified facts from assumptions');
    expect(grill).toContain('## 2. Required Question Format');
    expect(grill).toContain('**Acceptance Criteria**');
    expect(grill).toContain('## 3. Interview Workflow');
    expect(grill).toContain('Phase C — Close the interview');
    expect(grill).toContain('## 4. OpenSpec Decision Capture');
    expect(grill).toContain('### 4.6 Validate and preserve traceability');
    expect(grill).toContain('## 5. Quality Rules and Guardrails');
    expect(grill).toContain('## 6. Illustrative Example');
    expect(grill).toContain('## 7. Definition of Done');
    expect(grill).toContain('openissue start <id>');
    expect(grill).toContain('openissue list --status all --json');
    expect(grill).toContain('openissue create "<concise title>"');
    expect(grill).toContain('### 0.1 Resolve the requirement');
    expect(grill).toContain('Do not create an OpenSpec proposal before this step.');
    expect(grill).toContain('--from-interview');
    expect(grill).toContain('proposal');
    expect(grill).toContain('specs');
    expect(grill).toContain('design');
    expect(grill).toContain('End interview and generate tasks');
    expect(grill).toContain('not part of the planning scope');
    expect(grill).toContain('tasks are a separate handoff artifact');
    expect(grill).toContain('The interview has ended');
    expect(grill).toContain("project's TDD guidance");
    expect(grill).toContain('openspec instructions tasks --change');
    expect(grill).toContain('standard propose');
    expect(grill).toContain('RED');
    expect(grill).toContain('GREEN');
    expect(grill).toContain('REFACTOR');
    expect(grill).toContain('INTEGRATE');
    expect(output.skills.some((skill) => skill.name === 'openspec-grill-me')).toBe(false);
  });

  it('matches package version with the single version source', async () => {
    const packageJson = JSON.parse(await readFile(path.resolve('package.json'), 'utf8')) as {
      version: string;
      files: string[];
    };
    expect(VERSION).toBe(packageJson.version);
    expect(packageJson.files).toContain('skills');
  });
});

describe('skills install', () => {
  it('installs all bundled skills to agents and writes a manifest', async () => {
    const root = await createTempDir('openissue-skills-');
    cleanup.push(root);
    const result = await run(root, ['skills', 'install', '--json']);
    expect(result.status, result.stderr).toBe(0);
    const output = JSON.parse(result.stdout) as {
      tools: Array<{ tool: string; root: string; files: Array<{ action: string }> }>;
    };
    expect(output.tools).toHaveLength(1);
    expect(output.tools[0]!.tool).toBe('agents');
    expect(output.tools[0]!.files.filter((file) => file.action === 'installed')).toHaveLength(
      skillNames.length,
    );
    for (const name of skillNames) {
      const file = path.join(root.root, '.agents', 'skills', name, 'SKILL.md');
      expect(await exists(file), file).toBe(true);
      expect(await readFile(file, 'utf8')).toContain(`name: ${name}`);
    }
    expect(
      await exists(path.join(root.root, '.agents', 'skills', 'openspec-grill-me')),
    ).toBe(false);
    const manifest = await readManifest(root);
    expect(manifest.schema).toBe(1);
    expect(manifest.generator).toBe('openissue');
    expect(manifest.generator_version).toBe(VERSION);
    expect(Object.keys(manifest.skills).sort()).toEqual(skillNames);
    expect(Object.values(manifest.skills).every((skill) => /^[a-f0-9]{64}$/.test(skill.sha256))).toBe(true);
  });

  it('installs multiple tools and de-duplicates shared roots for all', async () => {
    const root = await createTempDir('openissue-skills-');
    cleanup.push(root);
    const multi = await run(root, ['skills', 'install', '--tool', 'claude,opencode', '--json']);
    expect(multi.status, multi.stderr).toBe(0);
    for (const dir of ['.claude', '.opencode']) {
      for (const name of skillNames) {
        expect(await exists(path.join(root.root, dir, 'skills', name, 'SKILL.md'))).toBe(true);
      }
    }
    expect(await exists(path.join(root.root, '.agents'))).toBe(false);

    const all = await run(root, ['skills', 'install', '--tool', 'all', '--json']);
    expect(all.status, all.stderr).toBe(0);
    const output = JSON.parse(all.stdout) as { tools: Array<{ tool: string; root: string }> };
    expect(output.tools).toHaveLength(9);
    expect(new Set(output.tools.map((tool) => tool.root)).size).toBe(9);
    expect(output.tools.some((tool) => tool.tool === 'agents')).toBe(true);
  });

  it('treats codex as the shared agents alias', async () => {
    const root = await createTempDir('openissue-skills-');
    cleanup.push(root);
    const result = await run(root, ['skills', 'install', '--tool', 'codex', '--json']);
    expect(result.status, result.stderr).toBe(0);
    const output = JSON.parse(result.stdout) as { tools: Array<{ tool: string; root: string }> };
    expect(output.tools).toHaveLength(1);
    expect(output.tools[0]!.tool).toBe('agents');
    expect(await exists(path.join(root.root, '.agents', 'skills', 'openissue-capture', 'SKILL.md'))).toBe(true);
    expect(await exists(path.join(root.root, '.codex'))).toBe(false);
  });

  it('rejects an unknown tool before writing anything', async () => {
    const root = await createTempDir('openissue-skills-');
    cleanup.push(root);
    const result = await run(root, ['skills', 'install', '--tool', 'unknown-tool']);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('未知的 skills 工具');
    expect(await exists(path.join(root.root, '.agents'))).toBe(false);

    const none = await run(root, ['skills', 'install', '--tool', 'none', '--json']);
    expect(none.status, none.stderr).toBe(0);
    expect(JSON.parse(none.stdout)).toEqual({ tools: [] });
    expect(await exists(path.join(root.root, '.agents'))).toBe(false);
  });

  it('is idempotent and refuses to overwrite user edits without force', async () => {
    const root = await createTempDir('openissue-skills-');
    cleanup.push(root);
    expect((await run(root, ['skills', 'install'])).status).toBe(0);
    const capture = path.join(root.root, '.agents', 'skills', 'openissue-capture', 'SKILL.md');
    const original = await readFile(capture, 'utf8');
    await writeFile(capture, `${original}\n用户补充\n`, 'utf8');

    const conflict = await run(root, ['skills', 'install', '--json']);
    expect(conflict.status).not.toBe(0);
    expect(conflict.stderr).toContain('已修改');
    expect(conflict.stderr).toContain('--force');
    expect(await readFile(capture, 'utf8')).toContain('用户补充');

    const forced = await run(root, ['skills', 'install', '--force', '--json']);
    expect(forced.status, forced.stderr).toBe(0);
    expect(await readFile(capture, 'utf8')).toBe(original);

    const again = await run(root, ['skills', 'install', '--json']);
    expect(again.status, again.stderr).toBe(0);
    const output = JSON.parse(again.stdout) as { tools: Array<{ files: Array<{ action: string }> }> };
    expect(output.tools[0]!.files.every((file) => file.action === 'unchanged')).toBe(true);
  });

  it('reports modified files and updates outdated files only', async () => {
    const root = await createTempDir('openissue-skills-');
    cleanup.push(root);
    expect((await run(root, ['skills', 'install'])).status).toBe(0);

    const capture = path.join(root.root, '.agents', 'skills', 'openissue-capture', 'SKILL.md');
    await writeFile(capture, 'local edit\n', 'utf8');
    const modified = await run(root, ['skills', 'status', '--json']);
    expect(modified.status, modified.stderr).toBe(0);
    const modifiedOutput = JSON.parse(modified.stdout) as {
      tools: Array<{ skills: Array<{ name: string; state: string }> }>;
    };
    expect(
      modifiedOutput.tools[0]!.skills.find((skill) => skill.name === 'openissue-capture')?.state,
    ).toBe('modified');
    expect(
      modifiedOutput.tools[0]!.skills.find((skill) => skill.name === 'openissue-handoff')?.state,
    ).toBe('current');

    const blockedUpdate = await run(root, ['skills', 'update', '--json']);
    expect(blockedUpdate.status).not.toBe(0);
    expect(await readFile(capture, 'utf8')).toBe('local edit\n');

    const outdated = await createTempDir('openissue-skills-');
    cleanup.push(outdated);
    expect((await run(outdated, ['skills', 'install'])).status).toBe(0);
    const outdatedFile = path.join(
      outdated.root,
      '.agents',
      'skills',
      'openissue-capture',
      'SKILL.md',
    );
    const oldContent = 'older generated content\n';
    await writeFile(outdatedFile, oldContent, 'utf8');
    const manifestFile = path.join(
      outdated.root,
      '.agents',
      'skills',
      '.openissue-skills.json',
    );
    const manifest = JSON.parse(await readFile(manifestFile, 'utf8')) as {
      skills: Record<string, { sha256: string }>;
    };
    manifest.skills['openissue-capture']!.sha256 = createHash('sha256')
      .update(oldContent)
      .digest('hex');
    await writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

    const outdatedStatus = await run(outdated, ['skills', 'status', '--json']);
    const outdatedOutput = JSON.parse(outdatedStatus.stdout) as {
      tools: Array<{ skills: Array<{ name: string; state: string }> }>;
    };
    expect(
      outdatedOutput.tools[0]!.skills.find((skill) => skill.name === 'openissue-capture')?.state,
    ).toBe('outdated');

    const updated = await run(outdated, ['skills', 'update', '--json']);
    expect(updated.status, updated.stderr).toBe(0);
    expect(await readFile(outdatedFile, 'utf8')).not.toBe(oldContent);
    const currentStatus = await run(outdated, ['skills', 'status', '--json']);
    const currentOutput = JSON.parse(currentStatus.stdout) as {
      tools: Array<{ skills: Array<{ name: string; state: string }> }>;
    };
    expect(
      currentOutput.tools[0]!.skills.every((skill) => skill.state === 'current'),
    ).toBe(true);
  });

  it('fails update when no skills are installed', async () => {
    const root = await createTempDir('openissue-skills-');
    cleanup.push(root);
    const result = await run(root, ['skills', 'update']);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('尚未安装配套 skills');
  });

  it('reports the legacy openspec-grill-me directory and migrates only with force', async () => {
    const root = await createTempDir('openissue-skills-');
    cleanup.push(root);
    const legacyDir = path.join(root.root, '.agents', 'skills', 'openspec-grill-me');
    await mkdir(legacyDir, { recursive: true });
    const legacyFile = path.join(legacyDir, 'SKILL.md');
    await writeFile(legacyFile, 'legacy user skill\n', 'utf8');

    const conflict = await run(root, ['skills', 'install']);
    expect(conflict.status).not.toBe(0);
    expect(conflict.stderr).toContain('未托管');
    expect(await readFile(legacyFile, 'utf8')).toBe('legacy user skill\n');

    const forced = await run(root, ['skills', 'install', '--force']);
    expect(forced.status, forced.stderr).toBe(0);
    await expect(access(legacyDir)).rejects.toThrow();
    expect(
      await exists(path.join(root.root, '.agents', 'skills', 'openissue-grill-me', 'SKILL.md')),
    ).toBe(true);
  });

  it('refuses to adopt an unmanaged file without force and reports missing files', async () => {
    const root = await createTempDir('openissue-skills-');
    cleanup.push(root);
    const unmanagedDir = path.join(root.root, '.agents', 'skills', 'openissue-capture');
    await mkdir(unmanagedDir, { recursive: true });
    const unmanaged = path.join(unmanagedDir, 'SKILL.md');
    await writeFile(unmanaged, 'user-owned skill\n', 'utf8');

    const conflict = await run(root, ['skills', 'install']);
    expect(conflict.status).not.toBe(0);
    expect(conflict.stderr).toContain('未托管');
    expect(await readFile(unmanaged, 'utf8')).toBe('user-owned skill\n');

    const forced = await run(root, ['skills', 'install', '--force']);
    expect(forced.status, forced.stderr).toBe(0);
    expect(await readFile(unmanaged, 'utf8')).toContain('name: openissue-capture');

    const missingFile = path.join(root.root, '.agents', 'skills', 'openissue-triage', 'SKILL.md');
    await rm(missingFile);
    const status = await run(root, ['skills', 'status', '--json']);
    const output = JSON.parse(status.stdout) as {
      tools: Array<{ skills: Array<{ name: string; state: string }> }>;
    };
    expect(output.tools[0]!.skills.find((skill) => skill.name === 'openissue-triage')?.state).toBe(
      'missing',
    );
  });
});

async function createSingleRepo(prefix: string): Promise<TempDir> {
  const root = await createTempDir(prefix);
  cleanup.push(root);
  await mkdir(path.join(root.root, '.git'));
  await createOpenspecSkeleton(root.root);
  return root;
}

describe('init integration', () => {
  it('installs skills by default and skips them only with none', async () => {
    const withSkills = await createSingleRepo('openissue-init-skills-');
    const installed = await run(withSkills, [
      'init',
      '--zh',
      '--id',
      'demo',
      '--name',
      'Demo',
      '--skills',
      'agents',
    ]);
    expect(installed.status, installed.stderr).toBe(0);
    expect(await exists(path.join(withSkills.root, 'openissue', 'product.yaml'))).toBe(true);
    expect(
      await exists(path.join(withSkills.root, '.agents', 'skills', 'openissue-capture', 'SKILL.md')),
    ).toBe(true);

    const defaults = await createSingleRepo('openissue-init-default-');
    const plain = await run(defaults, ['init', '--zh', '--id', 'demo', '--name', 'Demo']);
    expect(plain.status, plain.stderr).toBe(0);
    expect(
      await exists(path.join(defaults.root, '.agents', 'skills', 'openissue-capture', 'SKILL.md')),
    ).toBe(true);

    const skipped = await createSingleRepo('openissue-init-skip-');
    const none = await run(skipped, [
      'init',
      '--zh',
      '--id',
      'demo',
      '--name',
      'Demo',
      '--skills',
      'none',
    ]);
    expect(none.status, none.stderr).toBe(0);
    expect(await exists(path.join(skipped.root, '.agents'))).toBe(false);

    const bare = await createSingleRepo('openissue-init-bare-');
    const bareResult = await run(bare, ['init', '--zh', '--id', 'demo', '--name', 'Demo', '--skills']);
    expect(bareResult.status, bareResult.stderr).toBe(0);
    expect(
      await exists(path.join(bare.root, '.agents', 'skills', 'openissue-capture', 'SKILL.md')),
    ).toBe(true);
  });

  it('rejects a non-agents skills target before creating the product', async () => {
    const root = await createTempDir('openissue-init-invalid-');
    cleanup.push(root);
    const result = await run(root, ['init', '--zh', '--id', 'demo', '--skills', 'unknown-tool']);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('openissue skills install --tool unknown-tool');
    expect(await exists(path.join(root.root, 'openissue', 'product.yaml'))).toBe(false);
  });
});
