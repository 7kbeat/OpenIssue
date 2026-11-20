import { spawnSync } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { isRecord } from '../core/guards.js';

export interface OpenspecInitResult {
  status: 'success' | 'unavailable' | 'failed';
  stdout: string;
  stderr: string;
}

export async function hasCompleteOpenspecData(root: string): Promise<boolean> {
  return (
    (await isDirectory(path.join(root, 'openspec', 'specs'))) ||
    (await isDirectory(path.join(root, 'openspec', 'changes')))
  );
}

export async function readStorePointer(root: string): Promise<string | undefined> {
  const file = path.join(root, 'openspec', 'config.yaml');
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = YAML.parse(raw);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed) || typeof parsed.store !== 'string' || !parsed.store.trim()) {
    return undefined;
  }
  return parsed.store.trim();
}

export async function readAnchorStoreIds(
  anchorRoot: string,
  productId: string,
): Promise<string[]> {
  const ids = new Set<string>([productId]);
  const metadata = path.join(anchorRoot, '.openspec-store', 'store.yaml');
  try {
    const parsed = YAML.parse(await readFile(metadata, 'utf8'));
    if (isRecord(parsed) && typeof parsed.id === 'string' && parsed.id.trim()) {
      ids.add(parsed.id.trim());
    }
  } catch {
    // A non-store OpenIssue anchor still gets product-id matching.
  }
  return [...ids];
}

export function runOpenspecInit(
  root: string,
  tools: 'agents' | 'none',
  force = false,
): OpenspecInitResult {
  const bin = process.platform === 'win32' ? 'openspec.cmd' : 'openspec';
  const args = ['init', '--tools', tools, '--language', 'zh-CN', '--no-animation'];
  if (force) args.push('--force');
  const result = spawnSync(bin, args, {
    cwd: root,
    encoding: 'utf8',
    env: process.env,
    shell: process.platform === 'win32',
  });
  if (result.error) {
    const code = (result.error as NodeJS.ErrnoException).code;
    return {
      status: code === 'ENOENT' ? 'unavailable' : 'failed',
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? result.error.message,
    };
  }
  return {
    status: result.status === 0 ? 'success' : 'failed',
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

async function isDirectory(file: string): Promise<boolean> {
  try {
    return (await stat(file)).isDirectory();
  } catch {
    return false;
  }
}
