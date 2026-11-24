import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import YAML from 'yaml';
import { runCommand } from '../../src/core/command.js';

export interface TempDir {
  root: string;
  cleanup(): Promise<void>;
}

export async function createTempDir(prefix = 'openissue-test-'): Promise<TempDir> {
  const root = await mkdtemp(path.join(tmpdir(), prefix));
  return {
    root,
    cleanup: async () => {
      await rm(root, { recursive: true, force: true });
    },
  };
}

export interface AnchorOptions {
  id?: string;
  name?: string;
  focus?: string;
  members?: Array<{ id: string; name?: string; path?: string }>;
  openspec?: boolean;
}

export async function createAnchor(options: AnchorOptions = {}): Promise<TempDir> {
  const temp = await createTempDir('openissue-anchor-');
  const id = options.id ?? 'demo';
  const productDir = path.join(temp.root, 'openissue');
  await mkdir(path.join(productDir, 'issues'), { recursive: true });
  const product = {
    id,
    name: options.name ?? 'Demo Product',
    focus: options.focus ?? '',
    focus_updated_at: options.focus ? '2026-01-01T00:00:00.000Z' : null,
    members: options.members ?? [],
  };
  await writeFile(path.join(productDir, 'product.yaml'), YAML.stringify(product), 'utf8');
  if (options.openspec) {
    await createOpenspecSkeleton(temp.root);
  }
  return temp;
}

export async function createOpenspecSkeleton(root: string): Promise<void> {
  await mkdir(path.join(root, 'openspec', 'changes'), { recursive: true });
  await mkdir(path.join(root, 'openspec', 'specs'), { recursive: true });
  await writeFile(
    path.join(root, 'openspec', 'config.yaml'),
    'schema: spec-driven\n',
    'utf8',
  );
}

export async function createMember(
  products: Array<{ id: string; anchor: string }>,
): Promise<TempDir> {
  const temp = await createTempDir('openissue-member-');
  await writeFile(
    path.join(temp.root, 'openissue-project.yaml'),
    YAML.stringify({ products }),
    'utf8',
  );
  return temp;
}

export function runOpenspec(
  cwd: string,
  args: string[] = ['list'],
): { status: number | null; stdout: string; stderr: string } {
  const bin = process.platform === 'win32' ? 'openspec.cmd' : 'openspec';
  return runCommand(bin, args, { cwd });
}

export function runGit(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

export function runCli(
  args: string[],
  options: { cwd: string; env?: NodeJS.ProcessEnv },
): { status: number | null; stdout: string; stderr: string } {
  const tsxCli = path.resolve('node_modules', 'tsx', 'dist', 'cli.mjs');
  const cli = path.resolve('src', 'cli.ts');
  const result = spawnSync(process.execPath, [tsxCli, cli, ...args], {
    cwd: options.cwd,
    encoding: 'utf8',
    env: { ...process.env, ...options.env },
  });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

export function issueFixture(fields: Record<string, unknown>, description = ''): string {
  return `---\n${YAML.stringify(fields).trimEnd()}\n---\n\n${description}`.trimEnd() + '\n';
}

export async function writeTestRegistry(
  home: string,
  products: Record<string, { anchor_path: string; name?: string }>,
): Promise<void> {
  await mkdir(home, { recursive: true });
  await writeFile(
    path.join(home, 'registry.yaml'),
    YAML.stringify({ products }, { lineWidth: 0 }),
    'utf8',
  );
}
