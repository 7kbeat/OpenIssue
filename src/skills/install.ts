import { access, mkdir, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { OpenIssueError } from '../core/errors.js';
import { VERSION } from '../core/version.js';
import { writeTextAtomic } from '../storage/atomic.js';
import {
  canonicalSkillTools,
  hashSkillContent,
  loadBundledSkills,
  toolSkillsRoot,
  type SkillDefinition,
  type SkillTool,
} from './catalog.js';
import {
  readSkillManifest,
  skillManifestPath,
  writeSkillManifest,
  type SkillManifest,
  type SkillManifestEntry,
} from './manifest.js';

export type SkillFileAction = 'installed' | 'updated' | 'unchanged';
export type SkillFileState = 'missing' | 'current' | 'outdated' | 'modified' | 'unmanaged';

export interface InstalledSkillFile {
  name: string;
  path: string;
  action: SkillFileAction;
}

export interface ToolInstallResult {
  tool: SkillTool;
  root: string;
  manifestPath: string;
  files: InstalledSkillFile[];
}

export interface SkillStatusEntry {
  name: string;
  path: string;
  state: SkillFileState;
}

export interface ToolSkillStatus {
  tool: SkillTool;
  root: string;
  manifestPath: string;
  skills: SkillStatusEntry[];
}

interface PlannedFile {
  skill: SkillDefinition;
  path: string;
  action: SkillFileAction;
}

interface ToolPlan {
  tool: SkillTool;
  root: string;
  manifest: SkillManifest | undefined;
  files: PlannedFile[];
}

interface Conflict {
  path: string;
  kind: 'unmanaged' | 'modified';
}

export async function installSkills(
  projectDir: string,
  tools: SkillTool[],
  options: { force?: boolean; now?: string } = {},
): Promise<ToolInstallResult[]> {
  const skills = await loadBundledSkills();
  const now = options.now ?? new Date().toISOString();
  const plans: ToolPlan[] = [];
  const conflicts: Conflict[] = [];

  for (const tool of tools) {
    const root = toolSkillsRoot(projectDir, tool);
    const manifest = await readSkillManifest(root);
    const files: PlannedFile[] = [];
    for (const skill of skills) {
      const target = path.join(root, skill.name, 'SKILL.md');
      const current = await readOptional(target);
      if (current === undefined) {
        files.push({ skill, path: target, action: 'installed' });
        continue;
      }
      if (current === skill.content) {
        files.push({ skill, path: target, action: 'unchanged' });
        continue;
      }
      const recorded = manifest?.skills[skill.name];
      const currentHash = hashSkillContent(current);
      if (recorded && recorded.sha256 === currentHash) {
        files.push({ skill, path: target, action: 'updated' });
        continue;
      }
      if (options.force) {
        files.push({ skill, path: target, action: 'updated' });
        continue;
      }
      conflicts.push({ path: target, kind: recorded ? 'modified' : 'unmanaged' });
      files.push({ skill, path: target, action: 'unchanged' });
    }
    plans.push({ tool, root, manifest, files });
  }

  if (conflicts.length > 0) {
    const details = conflicts
      .map((item) => `  ${item.kind === 'modified' ? '已修改' : '未托管'}：${item.path}`)
      .join('\n');
    throw new OpenIssueError(
      `检测到未托管或已修改的 skills 文件，未写入任何内容：\n${details}\n确认覆盖时使用 --force。`,
      'SKILLS_CONFLICT',
    );
  }

  const results: ToolInstallResult[] = [];
  for (const plan of plans) {
    await mkdir(plan.root, { recursive: true });
    for (const file of plan.files) {
      if (file.action !== 'unchanged') {
        await writeTextAtomic(file.path, file.skill.content);
      }
    }
    const manifest = buildManifest(plan, now);
    if (manifest.dirty) {
      await writeSkillManifest(plan.root, manifest.value);
    }
    results.push({
      tool: plan.tool,
      root: plan.root,
      manifestPath: skillManifestPath(plan.root),
      files: plan.files.map((file) => ({
        name: file.skill.name,
        path: file.path,
        action: file.action,
      })),
    });
  }
  return results;
}

export async function statusSkills(
  projectDir: string,
  tools: SkillTool[],
): Promise<ToolSkillStatus[]> {
  const skills = await loadBundledSkills();
  const results: ToolSkillStatus[] = [];
  for (const tool of tools) {
    const root = toolSkillsRoot(projectDir, tool);
    const manifest = await readSkillManifest(root);
    const entries: SkillStatusEntry[] = [];
    for (const skill of skills) {
      const target = path.join(root, skill.name, 'SKILL.md');
      const current = await readOptional(target);
      let state: SkillFileState;
      if (current === undefined) {
        state = 'missing';
      } else {
        const currentHash = hashSkillContent(current);
        const recorded = manifest?.skills[skill.name];
        if (currentHash === skill.sha256) state = 'current';
        else if (!recorded) state = 'unmanaged';
        else if (currentHash === recorded.sha256) state = 'outdated';
        else state = 'modified';
      }
      entries.push({ name: skill.name, path: target, state });
    }
    results.push({
      tool,
      root,
      manifestPath: skillManifestPath(root),
      skills: entries,
    });
  }
  return results;
}

export async function detectInstalledSkillTools(projectDir: string): Promise<SkillTool[]> {
  const tools: SkillTool[] = [];
  for (const tool of canonicalSkillTools()) {
    const root = toolSkillsRoot(projectDir, tool);
    if (await exists(skillManifestPath(root))) {
      tools.push(tool);
      continue;
    }
    try {
      const entries = await readdir(root, { withFileTypes: true });
      let hasSkill = false;
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (await exists(path.join(root, entry.name, 'SKILL.md'))) {
          hasSkill = true;
          break;
        }
      }
      if (hasSkill) tools.push(tool);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return tools;
}

export function summarizeInstall(results: ToolInstallResult[]): string {
  const total = results.reduce((sum, result) => sum + result.files.length, 0);
  const changed = results.reduce(
    (sum, result) => sum + result.files.filter((file) => file.action !== 'unchanged').length,
    0,
  );
  const roots = results.map((result) => result.root);
  return `已安装 ${total} 个 skill 文件到 ${roots.length} 个目录（写入 ${changed} 个；${total - changed} 个未变化）`;
}

function buildManifest(
  plan: ToolPlan,
  now: string,
): { value: SkillManifest; dirty: boolean } {
  const existing = plan.manifest;
  const skills: Record<string, SkillManifestEntry> = { ...(existing?.skills ?? {}) };
  let dirty = existing === undefined;
  for (const file of plan.files) {
    const previous = skills[file.skill.name];
    if (!previous) dirty = true;
    if (previous?.sha256 !== file.skill.sha256) dirty = true;
    if (file.action !== 'unchanged') dirty = true;
    skills[file.skill.name] = {
      sha256: file.skill.sha256,
      installed_at: previous?.installed_at ?? now,
      updated_at: file.action === 'unchanged' && previous ? previous.updated_at : now,
    };
  }
  return {
    value: {
      schema: 1,
      generator: 'openissue',
      generator_version: VERSION,
      installed_at: existing?.installed_at ?? now,
      updated_at: dirty ? now : (existing?.updated_at ?? now),
      skills,
    },
    dirty,
  };
}

async function readOptional(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}
