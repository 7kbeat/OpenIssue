import path from 'node:path';
import type { Command } from 'commander';
import { OpenIssueError } from '../core/errors.js';
import { toPosix } from '../core/paths.js';
import {
  loadBundledSkills,
  resolveSkillTools,
  SKILL_TOOLS,
  type SkillTool,
} from '../skills/catalog.js';
import {
  detectInstalledSkillTools,
  installSkills,
  statusSkills,
  summarizeInstall,
  type SkillFileAction,
  type SkillFileState,
} from '../skills/install.js';

interface InstallOptions {
  tool?: string;
  force?: boolean;
  json?: boolean;
}

interface QueryOptions {
  tool?: string;
  json?: boolean;
}

export function registerSkillsCommands(program: Command): void {
  const skills = program
    .command('skills')
    .description('管理配套 Agent skills');

  skills
    .command('list')
    .description('列出随包 skills 与支持的安装目标')
    .option('--json', '输出 JSON')
    .action(async (options: { json?: boolean }) => {
      const bundled = await loadBundledSkills();
      if (options.json) {
        console.log(
          JSON.stringify(
            {
              skills: bundled.map(({ name, description }) => ({ name, description })),
              tools: SKILL_TOOLS.map((tool) => ({
                id: tool.id,
                name: tool.name,
                directory: tool.directory,
                ...(tool.aliasOf ? { aliasOf: tool.aliasOf } : {}),
              })),
            },
            null,
            2,
          ),
        );
        return;
      }
      console.log('随包 skills：');
      for (const skill of bundled) {
        console.log(`  ${skill.name}  ${skill.description}`);
      }
      console.log('\n支持的工具：');
      for (const tool of SKILL_TOOLS) {
        const alias = tool.aliasOf ? `（${tool.aliasOf} 的别名）` : '';
        console.log(`  ${tool.id.padEnd(16)} ${tool.directory}/skills${alias}`);
      }
    });

  skills
    .command('install')
    .description('把配套 skills 安装到项目内的 AI 工具目录')
    .option('--tool <tools>', '目标工具，逗号分隔；支持 all 与 none，默认 agents', 'agents')
    .option('--force', '覆盖未托管或已被用户修改的副本')
    .option('--json', '输出 JSON')
    .action(async (options: InstallOptions) => {
      const tools = resolveSkillTools(options.tool);
      if (tools.length === 0) {
        if (options.json) console.log(JSON.stringify({ tools: [] }, null, 2));
        else console.log('未选择任何工具，跳过 skills 安装。');
        return;
      }
      const results = await installSkills(process.cwd(), tools, {
        ...(options.force ? { force: true } : {}),
      });
      if (options.json) {
        console.log(JSON.stringify({ tools: jsonResults(results) }, null, 2));
        return;
      }
      for (const result of results) {
        const counts = countActions(result.files);
        console.log(
          `${result.tool.id}: ${rootLabel(result.root)}（写入 ${counts.installed}，更新 ${counts.updated}，未变化 ${counts.unchanged}）`,
        );
      }
      console.log(summarizeInstall(results));
    });

  skills
    .command('status')
    .description('只读检查已安装 skills 的状态')
    .option('--tool <tools>', '目标工具，逗号分隔；支持 all 与 none')
    .option('--json', '输出 JSON')
    .action(async (options: QueryOptions) => {
      const tools = await toolsForQuery(options.tool);
      if (tools.length === 0) {
        if (options.json) console.log(JSON.stringify({ tools: [] }, null, 2));
        else console.log('尚未安装配套 skills；运行 openissue skills install 安装。');
        return;
      }
      const results = await statusSkills(process.cwd(), tools);
      if (options.json) {
        console.log(JSON.stringify({ tools: jsonStatuses(results) }, null, 2));
        return;
      }
      for (const result of results) {
        console.log(`${result.tool.id}: ${rootLabel(result.root)}`);
        for (const skill of result.skills) {
          console.log(`  ${stateLabel(skill.state).padEnd(10)} ${skill.name}  ${rootLabel(skill.path)}`);
        }
      }
    });

  skills
    .command('update')
    .description('更新未修改的已安装 skills；默认只处理已检测到的目录')
    .option('--tool <tools>', '目标工具，逗号分隔；支持 all 与 none')
    .option('--force', '覆盖已被用户修改的副本')
    .option('--json', '输出 JSON')
    .action(async (options: InstallOptions) => {
      const tools = await toolsForQuery(options.tool, 'update');
      const results = await installSkills(process.cwd(), tools, {
        ...(options.force ? { force: true } : {}),
      });
      if (options.json) {
        console.log(JSON.stringify({ tools: jsonResults(results) }, null, 2));
        return;
      }
      for (const result of results) {
        const counts = countActions(result.files);
        console.log(
          `${result.tool.id}: ${rootLabel(result.root)}（写入 ${counts.installed}，更新 ${counts.updated}，未变化 ${counts.unchanged}）`,
        );
      }
      console.log(summarizeInstall(results));
    });
}

async function toolsForQuery(value: string | undefined, purpose: 'status' | 'update' = 'status'): Promise<SkillTool[]> {
  const explicit = value !== undefined ? resolveSkillTools(value) : undefined;
  if (explicit !== undefined) return explicit;
  const detected = await detectInstalledSkillTools(process.cwd());
  if (detected.length === 0 && purpose === 'update') {
    throw new OpenIssueError(
      '尚未安装配套 skills；先运行 openissue skills install，或使用 --tool 指定目标。',
      'SKILLS_NOT_INSTALLED',
    );
  }
  return detected;
}

function rootLabel(file: string): string {
  const relative = path.relative(process.cwd(), file);
  return toPosix(relative || '.');
}

function countActions(files: Array<{ action: SkillFileAction }>): Record<SkillFileAction, number> {
  return {
    installed: files.filter((file) => file.action === 'installed').length,
    updated: files.filter((file) => file.action === 'updated').length,
    unchanged: files.filter((file) => file.action === 'unchanged').length,
  };
}

function stateLabel(state: SkillFileState): string {
  switch (state) {
    case 'missing':
      return '缺失';
    case 'current':
      return '已安装';
    case 'outdated':
      return '待更新';
    case 'modified':
      return '已修改';
    case 'unmanaged':
      return '未托管';
  }
}

function jsonResults(results: Awaited<ReturnType<typeof installSkills>>): unknown[] {
  return results.map((result) => ({
    tool: result.tool.id,
    directory: result.tool.directory,
    root: result.root,
    manifest: result.manifestPath,
    files: result.files.map((file) => ({
      name: file.name,
      path: file.path,
      action: file.action,
    })),
  }));
}

function jsonStatuses(results: Awaited<ReturnType<typeof statusSkills>>): unknown[] {
  return results.map((result) => ({
    tool: result.tool.id,
    directory: result.tool.directory,
    root: result.root,
    manifest: result.manifestPath,
    skills: result.skills.map((skill) => ({
      name: skill.name,
      path: skill.path,
      state: skill.state,
    })),
  }));
}
