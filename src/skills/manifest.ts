import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { OpenIssueError } from '../core/errors.js';
import { isRecord } from '../core/guards.js';
import { writeTextAtomic } from '../storage/atomic.js';

export const SKILL_MANIFEST_FILE = '.openissue-skills.json';

export interface SkillManifestEntry {
  sha256: string;
  installed_at: string;
  updated_at: string;
}

export interface SkillManifest {
  schema: 1;
  generator: 'openissue';
  generator_version: string;
  installed_at: string;
  updated_at: string;
  skills: Record<string, SkillManifestEntry>;
}

export function skillManifestPath(root: string): string {
  return path.join(root, SKILL_MANIFEST_FILE);
}

export async function readSkillManifest(root: string): Promise<SkillManifest | undefined> {
  const file = skillManifestPath(root);
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new OpenIssueError(
      `skills 清单解析失败：${file}（${error instanceof Error ? error.message : String(error)}）`,
      'INVALID_SKILL_MANIFEST',
    );
  }
  if (
    !isRecord(parsed) ||
    parsed.schema !== 1 ||
    parsed.generator !== 'openissue' ||
    !isRecord(parsed.skills)
  ) {
    throw new OpenIssueError(`skills 清单格式无效：${file}`, 'INVALID_SKILL_MANIFEST');
  }
  const skills: Record<string, SkillManifestEntry> = {};
  for (const [name, value] of Object.entries(parsed.skills)) {
    if (
      !isRecord(value) ||
      typeof value.sha256 !== 'string' ||
      typeof value.installed_at !== 'string' ||
      typeof value.updated_at !== 'string'
    ) {
      throw new OpenIssueError(`skills 清单项格式无效：${name}`, 'INVALID_SKILL_MANIFEST');
    }
    skills[name] = {
      sha256: value.sha256,
      installed_at: value.installed_at,
      updated_at: value.updated_at,
    };
  }
  return {
    schema: 1,
    generator: 'openissue',
    generator_version: typeof parsed.generator_version === 'string' ? parsed.generator_version : 'unknown',
    installed_at: typeof parsed.installed_at === 'string' ? parsed.installed_at : new Date(0).toISOString(),
    updated_at: typeof parsed.updated_at === 'string' ? parsed.updated_at : new Date(0).toISOString(),
    skills,
  };
}

export async function writeSkillManifest(root: string, manifest: SkillManifest): Promise<void> {
  await writeTextAtomic(
    skillManifestPath(root),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
}
