import type { Command } from 'commander';
import { OpenIssueError } from '../core/errors.js';
import { resolveSkillTools, type SkillTool } from '../skills/catalog.js';
import { runInit, type InitReport } from '../services/workspace-init.js';

interface InitCliOptions {
  id?: string;
  name?: string;
  skills?: string | boolean;
  new?: boolean;
  yes?: boolean;
  member?: string[];
  members?: boolean;
  openspec?: boolean;
  rescan?: boolean;
  force?: boolean;
  json?: boolean;
}

export function registerInitCommand(program: Command): void {
  program
    .command('init')
    .description('接入既有 workspace/单仓，或从空 workspace 创建新项目')
    .option('--id <id>', '既有锚点或单仓的产品标识')
    .option('--name <name>', '产品名称；全新项目使用英文项目名')
    .option('--skills [tools]', '安装配套 skills；缺省 agents，none 跳过')
    .option('--new', '在工作区创建全新项目')
    .option('--yes', '确认默认选择与创建')
    .option(
      '--member <path>',
      '选择成员仓库，可重复',
      (value: string, previous: string[] = []) => [...previous, value],
      [],
    )
    .option('--no-members', '跳过成员仓库登记')
    .option('--openspec', '缺少 OpenSpec 时补初始化')
    .option('--no-openspec', '缺少 OpenSpec 时跳过')
    .option('--rescan', '重新扫描锚点并修复 workspace 指针')
    .option('--force', '覆盖冲突的生成文件或 skills')
    .option('--json', '输出 JSON')
    .action(async (options: InitCliOptions, command: Command) => {
      const global = command.optsWithGlobals() as { anchor?: string; product?: string };
      const skills = resolveInitSkills(options.skills);
      const report = await runInit({
        cwd: process.cwd(),
        id: options.id,
        name: options.name,
        anchorPath: global.anchor,
        skills,
        newProject: options.new,
        yes: options.yes,
        memberPaths: options.member ?? [],
        skipMembers: options.members === false,
        openspec: options.openspec,
        rescan: options.rescan,
        force: options.force,
      });
      printReport(report, options.json === true);
      if (report.status !== 'success') process.exitCode = 1;
    });
}

function resolveInitSkills(value: string | boolean | undefined): SkillTool[] {
  if (typeof value !== 'string') return resolveSkillTools('agents');
  const raw = value.trim().toLowerCase();
  if (!raw || raw === 'agents') return resolveSkillTools('agents');
  if (raw === 'none') return [];
  throw new OpenIssueError(
    `init 只默认安装到 .agents/skills；请使用 openissue skills install --tool ${raw} 安装其他工具。`,
    'INIT_SKILLS_TARGET',
  );
}

function printReport(report: InitReport, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(`初始化模式：${report.mode}`);
  console.log(`workspace：${report.workspace_root}`);
  if (report.anchor_root) console.log(`锚点：${report.anchor_root}`);
  if (report.product) console.log(`产品：${report.product.id}（${report.product.name}）`);
  if (report.code_root) console.log(`代码仓：${report.code_root}`);
  if (report.spec_root) console.log(`spec 仓：${report.spec_root}`);
  if (report.pointer) {
    console.log(
      `workspace 指针：${report.pointer.path}（${report.pointer.reused ? '复用' : '写入'}，锚点 ${report.pointer.anchor}）`,
    );
  }
  if (report.candidates) {
    console.log('\n锚点候选：');
    if (report.candidates.anchors.length === 0) console.log('  无');
    for (const candidate of report.candidates.anchors) {
      console.log(`  - ${candidate.path}（${candidate.kind}）`);
    }
    if (report.candidates.members.length > 0) {
      console.log('成员候选：');
      for (const candidate of report.candidates.members) {
        const mark = candidate.conflict
          ? `冲突：${candidate.conflict}`
          : candidate.preselected
            ? '预选'
            : '未选';
        console.log(`  - ${candidate.path}（${mark}）`);
      }
    }
  }
  if (report.members.length > 0) {
    console.log('\n成员结果：');
    for (const member of report.members) {
      const reason = member.reason ? ` — ${member.reason}` : '';
      console.log(`  - ${member.id} ${member.path}（${member.status}${reason}）`);
    }
  }
  console.log('\n阶段：');
  for (const phase of report.phases) {
    const mark = phase.status === 'success' ? '✓' : phase.status === 'failed' ? '✗' : '-';
    console.log(`  ${mark} ${phase.label}${phase.message ? ` — ${phase.message}` : ''}`);
  }
  if (report.warnings.length > 0) {
    console.log('\n警告：');
    for (const warning of report.warnings) console.log(`  - ${warning}`);
  }
  if (report.next.length > 0) {
    console.log('\n下一步：');
    for (const command of report.next) console.log(`  ${command}`);
  }
  if (report.status !== 'success') {
    console.log('\n初始化未完整完成；已创建内容保留，可按上面的下一步重试。');
  } else {
    console.log('\n初始化完成。');
  }
}
