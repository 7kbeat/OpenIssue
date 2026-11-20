import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { OpenIssueError } from '../core/errors.js';
import { isRecord } from '../core/guards.js';

export interface SkillDefinition {
  name: string;
  description: string;
  content: string;
  sha256: string;
}

export interface SkillTool {
  id: string;
  name: string;
  directory: string;
  aliasOf?: string;
}

export interface SkillCatalog {
  skills: SkillDefinition[];
  tools: SkillTool[];
}

export const SKILL_TOOLS: SkillTool[] = [
  { id: 'agents', name: '共享 .agents', directory: '.agents' },
  { id: 'claude', name: 'Claude Code', directory: '.claude' },
  { id: 'opencode', name: 'OpenCode', directory: '.opencode' },
  { id: 'cursor', name: 'Cursor', directory: '.cursor' },
  { id: 'github-copilot', name: 'GitHub Copilot', directory: '.github' },
  { id: 'qwen', name: 'Qwen Code', directory: '.qwen' },
  { id: 'gemini', name: 'Gemini CLI', directory: '.gemini' },
  { id: 'trae', name: 'Trae', directory: '.trae' },
  { id: 'oh-my-pi', name: 'Oh My Pi', directory: '.omp' },
  { id: 'codex', name: 'Codex', directory: '.agents', aliasOf: 'agents' },
];

export function bundledSkillsDirectory(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'skills');
}

export async function loadBundledSkills(): Promise<SkillDefinition[]> {
  const root = bundledSkillsDirectory();
  let entries: Dirent[];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      throw new OpenIssueError(`找不到配套 skills 目录：${root}`, 'INVALID_SKILL_ASSET');
    }
    throw error;
  }
  const skills: SkillDefinition[] = [];
  for (const entry of entries.filter((item) => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const file = path.join(root, entry.name, 'SKILL.md');
    const content = await readFile(file, 'utf8');
    const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
    if (!match) {
      throw new OpenIssueError(`skill ${entry.name} 缺少 frontmatter`, 'INVALID_SKILL_ASSET');
    }
    let parsed: unknown;
    try {
      parsed = YAML.parse(match[1]!);
    } catch (error) {
      throw new OpenIssueError(
        `skill ${entry.name} 的 frontmatter 解析失败：${error instanceof Error ? error.message : String(error)}`,
        'INVALID_SKILL_ASSET',
      );
    }
    if (!isRecord(parsed) || typeof parsed.name !== 'string' || typeof parsed.description !== 'string') {
      throw new OpenIssueError(`skill ${entry.name} 缺少 name 或 description`, 'INVALID_SKILL_ASSET');
    }
    if (parsed.name !== entry.name) {
      throw new OpenIssueError(
        `skill 目录 ${entry.name} 与 frontmatter name ${parsed.name} 不一致`,
        'INVALID_SKILL_ASSET',
      );
    }
    if (!parsed.description.trim()) {
      throw new OpenIssueError(`skill ${entry.name} 的 description 不能为空`, 'INVALID_SKILL_ASSET');
    }
    skills.push({
      name: parsed.name,
      description: parsed.description,
      content,
      sha256: hashSkillContent(content),
    });
  }
  if (skills.length === 0) {
    throw new OpenIssueError(`配套 skills 目录为空：${root}`, 'INVALID_SKILL_ASSET');
  }
  return skills;
}

export function hashSkillContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

export function canonicalSkillTools(): SkillTool[] {
  return SKILL_TOOLS.filter((tool) => !tool.aliasOf);
}

export function resolveSkillTools(value: string | boolean | undefined): SkillTool[] {
  if (value === undefined || value === true) return [toolById('agents')];
  if (typeof value !== 'string') return [toolById('agents')];
  const raw = value.trim();
  if (!raw || raw === 'none') return [];
  const selected: SkillTool[] = [];
  const seenDirectories = new Set<string>();
  for (const token of raw.split(',').map((item) => item.trim().toLowerCase()).filter(Boolean)) {
    if (token === 'all') {
      for (const tool of canonicalSkillTools()) addTool(tool);
      continue;
    }
    const tool = SKILL_TOOLS.find((candidate) => candidate.id === token);
    if (!tool) {
      throw new OpenIssueError(
        `未知的 skills 工具：${token}；支持 ${SKILL_TOOLS.map((item) => item.id).join('、')} 或 all、none`,
        'INVALID_SKILL_TOOL',
      );
    }
    addTool(tool.aliasOf ? toolById(tool.aliasOf) : tool);
  }
  return selected;

  function addTool(tool: SkillTool): void {
    if (seenDirectories.has(tool.directory)) return;
    seenDirectories.add(tool.directory);
    selected.push(tool);
  }
}

function toolById(id: string): SkillTool {
  const tool = SKILL_TOOLS.find((candidate) => candidate.id === id);
  if (!tool) throw new OpenIssueError(`未知的 skills 工具：${id}`, 'INVALID_SKILL_TOOL');
  return tool;
}

export function toolSkillsRoot(projectDir: string, tool: SkillTool): string {
  return path.join(path.resolve(projectDir), tool.directory, 'skills');
}
