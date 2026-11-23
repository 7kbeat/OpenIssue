import type { Command } from 'commander';
import { OpenIssueError, errorMessage } from '../core/errors.js';
import type { Language, LanguageSource } from '../core/language.js';
import { resolveSkillTools, type SkillTool } from '../skills/catalog.js';
import { runInitTui } from '../services/init-tui.js';
import { runInit, type InitReport } from '../services/workspace-init.js';
import {
  loadLanguageSelection,
  peekLanguageSelection,
  saveExplicitLanguage,
} from '../storage/preferences.js';

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
  zh?: boolean;
  en?: boolean;
}

interface InitErrorEnvelope {
  mode: string;
  status: 'failed';
  error: { code: string; message: string };
  phases: [];
  created: [];
  next: string[];
  language: Language;
  language_source: LanguageSource;
  warnings?: string[];
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
    .option('--zh', '使用中文初始化界面与输出')
    .option('--en', '使用英文初始化界面与输出')
    .option('--json', '输出 JSON')
    .addHelpText(
      'after',
      `
示例:
  openissue init --anchor ../demo-spec --yes --json
  openissue init --new --name "Demo Product" --yes --json
  openissue init --anchor ../demo-spec --openspec --json
  openissue init --rescan --json
`,
    )
    .action(async (options: InitCliOptions, command: Command) => {
      const global = command.optsWithGlobals() as { anchor?: string; product?: string };
      const cwd = process.cwd();
      const json = options.json === true;
      let language: Language = 'zh';
      let languageSource: LanguageSource = 'system';

      try {
        if (options.zh && options.en) {
          const fallback = await peekLanguageSelection(cwd);
          if (json) {
            printJsonError(
              new OpenIssueError(
                pick(fallback.language, '不能同时使用 --zh 与 --en。', 'Cannot use --zh and --en together.'),
                'LANGUAGE_CONFLICT',
              ),
              fallback.language,
              fallback.source,
              options,
              fallback.warning,
            );
            process.exitCode = 1;
            return;
          }
          throw new OpenIssueError(
            pick(fallback.language, '不能同时使用 --zh 与 --en。', 'Cannot use --zh and --en together.'),
            'LANGUAGE_CONFLICT',
          );
        }

        const explicit = options.zh ? 'zh' : options.en ? 'en' : undefined;
        if (explicit) {
          const saved = await saveExplicitLanguage(cwd, explicit);
          if (saved.warning && !json) console.error(`警告：${saved.warning}`);
        }
        const selection = await loadLanguageSelection(
          cwd,
          explicit ? { explicit } : {},
        );
        language = selection.language;
        languageSource = selection.source;

        const skills = resolveInitSkills(options.skills);
        const interactive =
          !json && process.stdin.isTTY === true && process.stdout.isTTY === true;
        const initOptions = {
          cwd,
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
          language,
          languageSource,
          interactive,
        };
        if (selection.warning && !json) console.error(`警告：${selection.warning}`);

        if (interactive) {
          const outcome = await runInitTui(initOptions);
          if (outcome.kind === 'cancelled') return;
          const finished = outcome.report;
          if (finished.status !== 'success') process.exitCode = 1;
          return;
        }

        const report = await runInit(initOptions);
        report.language = language;
        report.language_source = languageSource;
        if (selection.warning) report.warnings.unshift(selection.warning);
        if (json) {
          console.log(JSON.stringify(report, null, 2));
        } else {
          printReport(report, language);
        }
        if (report.status !== 'success') process.exitCode = 1;
      } catch (error) {
        if (json) {
          printJsonError(error, language, languageSource, options);
          process.exitCode = 1;
          return;
        }
        if (error instanceof OpenIssueError) {
          throw new OpenIssueError(
            localizeError(error, language),
            error.code,
            error.exitCode,
          );
        }
        throw error;
      }
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

function printJsonError(
  error: unknown,
  language: Language,
  source: LanguageSource,
  options: InitCliOptions,
  warning?: string,
): void {
  const code = error instanceof OpenIssueError ? error.code : 'OPENISSUE_ERROR';
  const message = localizeError(error, language);
  const envelope: InitErrorEnvelope = {
    mode: options.new ? 'new-project' : 'unknown',
    status: 'failed',
    error: { code, message },
    phases: [],
    created: [],
    next: recoveryCommands(code, language, options),
    language,
    language_source: source,
    ...(warning ? { warnings: [warning] } : {}),
  };
  console.log(JSON.stringify(envelope, null, 2));
}

function recoveryCommands(
  code: string,
  language: Language,
  options: InitCliOptions,
): string[] {
  const lang = language === 'zh' ? '--zh' : '--en';
  const base = `openissue init ${lang} --json`;
  switch (code) {
    case 'ANCHOR_SELECTION_REQUIRED':
      return [`openissue init --anchor <path> ${lang} --json`];
    case 'MEMBER_CONFIRMATION_REQUIRED':
      return [
        `openissue init --member <path> ${lang} --json`,
        `openissue init --no-members ${lang} --json`,
      ];
    case 'OPENSPEC_CONFIRMATION_REQUIRED':
      return [
        `openissue init --openspec ${lang} --json`,
        `openissue init --no-openspec ${lang} --json`,
      ];
    case 'PROJECT_NAME_REQUIRED':
      return [
        `openissue init --new --name <english-name> ${lang} --json`,
      ];
    case 'CONFIRMATION_REQUIRED':
      return [`${base} --yes`];
    case 'LANGUAGE_CONFLICT':
      return [`openissue init ${lang} --json`];
    case 'INIT_SKILLS_TARGET':
      return ['openissue skills install --tool <tool>'];
    default:
      return [base];
  }
}

function localizeError(error: unknown, language: Language): string {
  if (!(error instanceof OpenIssueError)) return errorMessage(error);
  if (language === 'zh') return error.message;
  const map: Record<string, [string, string]> = {
    LANGUAGE_CONFLICT: ['不能同时使用 --zh 与 --en。', 'Cannot use --zh and --en together.'],
    ANCHOR_SELECTION_REQUIRED: [
      '发现多个锚点候选，请用 --anchor <path> 明确选择。',
      'Multiple anchor candidates found; select one with --anchor <path>.',
    ],
    MEMBER_CONFIRMATION_REQUIRED: [
      '发现成员候选，请用 --member 选择、--no-members 跳过，或用 --yes 接受预选项。',
      'Member candidates found; use --member, --no-members, or --yes for preselected members.',
    ],
    OPENSPEC_CONFIRMATION_REQUIRED: [
      'OpenSpec 尚未初始化，请加 --openspec 或 --no-openspec。',
      'OpenSpec is not initialized; add --openspec or --no-openspec.',
    ],
    PROJECT_NAME_REQUIRED: [
      '全新项目需要英文项目名，请追加 --name <name>。',
      'A new project requires an English name; add --name <name>.',
    ],
    CONFIRMATION_REQUIRED: [
      '需要确认，请追加 --yes。',
      'Confirmation is required; add --yes.',
    ],
    INVALID_PROJECT_NAME: [
      '项目名必须为英文，且只能包含字母、数字、空格、下划线与连字符。',
      'Project name must be English and contain only letters, digits, spaces, underscores, and hyphens.',
    ],
    INIT_DIRECTORY_CONFLICT: [
      '目标目录已存在，请修改项目名或确认恢复中断的初始化。',
      'Target directory already exists; change the name or confirm resuming an interrupted initialization.',
    ],
    INIT_SKILLS_TARGET: [
      'init 只默认安装到 .agents/skills；请使用 openissue skills install --tool <tool> 安装其他工具。',
      'init installs only to .agents/skills; use openissue skills install --tool <tool> for other tools.',
    ],
    ALREADY_INITIALIZED: [
      '当前目录已经是 OpenIssue 锚点仓库。',
      'The current directory is already an OpenIssue anchor repository.',
    ],
    WORKSPACE_ROOT_REQUIRED: [
      '当前目录不是 workspace 根，请到 workspace 根运行。',
      'The current directory is not the workspace root; run from the workspace root.',
    ],
    NESTED_GIT_REPOSITORY: [
      '当前目录位于 Git 仓内部，请到仓根运行或用 --anchor 指定锚点。',
      'The current directory is inside a Git repository; run from the repository root or use --anchor.',
    ],
    ANCHOR_REQUIRED: [
      '当前 workspace 没有锚点，请用 --anchor 指定或取消初始化。',
      'The workspace has no anchor; specify one with --anchor or cancel.',
    ],
    WORKSPACE_NOT_EMPTY: [
      '当前 workspace 有普通内容，请明确使用 --new 或指定其他目录。',
      'The workspace contains ordinary content; use --new explicitly or choose another directory.',
    ],
    INIT_FILE_CONFLICT: [
      '目标文件已存在且内容不同，确认覆盖时使用 --force。',
      'A target file already exists with different content; use --force to overwrite.',
    ],
    PRODUCT_MISMATCH: [
      '锚点产品标识与请求不一致。',
      'The anchor product id does not match the request.',
    ],
  };
  const entry = map[error.code];
  if (entry) return pick(language, entry[0], entry[1]);
  return language === 'en'
    ? `Initialization failed (${error.code}).`
    : error.message;
}

function printReport(report: InitReport, language: Language): void {
  console.log(`${pick(language, '初始化模式', 'Init mode')}：${modeLabel(report.mode, language)}`);
  console.log(`${pick(language, '语言', 'Language')}：${language === 'zh' ? '中文' : 'English'}`);
  console.log(`workspace：${report.workspace_root}`);
  if (report.anchor_root) console.log(`${pick(language, '锚点', 'Anchor')}：${report.anchor_root}`);
  if (report.product) {
    console.log(
      `${pick(language, '产品', 'Product')}：${report.product.id}（${report.product.name}）`,
    );
  }
  if (report.code_root) console.log(`${pick(language, '代码仓', 'Code repo')}：${report.code_root}`);
  if (report.spec_root) console.log(`${pick(language, 'spec 仓', 'Spec repo')}：${report.spec_root}`);
  if (report.pointer) {
    console.log(
      `${pick(language, 'workspace 指针', 'Workspace pointer')}：${report.pointer.path}（${report.pointer.reused ? pick(language, '复用', 'reused') : pick(language, '写入', 'written')}，${pick(language, '锚点', 'anchor')} ${report.pointer.anchor}）`,
    );
  }
  if (report.candidates) {
    console.log(`\n${pick(language, '锚点候选', 'Anchor candidates')}：`);
    if (report.candidates.anchors.length === 0) {
      console.log(`  ${pick(language, '无', 'none')}`);
    }
    for (const candidate of report.candidates.anchors) {
      console.log(`  - ${candidate.path}（${candidate.kind}）`);
    }
    if (report.candidates.members.length > 0) {
      console.log(`${pick(language, '成员候选', 'Member candidates')}：`);
      for (const candidate of report.candidates.members) {
        const mark = candidate.conflict
          ? `${pick(language, '冲突', 'conflict')}：${candidate.conflict}`
          : candidate.preselected
            ? pick(language, '预选', 'preselected')
            : pick(language, '未选', 'not selected');
        console.log(`  - ${candidate.path}（${mark}）`);
      }
    }
  }
  if (report.members.length > 0) {
    console.log(`\n${pick(language, '成员结果', 'Member results')}：`);
    for (const member of report.members) {
      const reason = member.reason ? ` — ${member.reason}` : '';
      console.log(`  - ${member.id} ${member.path}（${member.status}${reason}）`);
    }
  }
  console.log(`\n${pick(language, '阶段', 'Phases')}：`);
  for (const phase of report.phases) {
    const mark = phase.status === 'success' ? '✓' : phase.status === 'failed' ? '✗' : '-';
    console.log(`  ${mark} ${phaseLabel(phase.label, language)}${phase.message ? ` — ${phase.message}` : ''}`);
  }
  if (report.warnings.length > 0) {
    console.log(`\n${pick(language, '警告', 'Warnings')}：`);
    for (const warning of report.warnings) console.log(`  - ${warning}`);
  }
  if (report.next.length > 0) {
    console.log(`\n${pick(language, '下一步', 'Next')}：`);
    for (const command of report.next) console.log(`  ${command}`);
  }
  if (report.status !== 'success') {
    console.log(
      `\n${pick(language, '初始化未完整完成；已创建内容保留，可按上面的下一步重试。', 'Initialization is incomplete; created content is preserved. Use the next commands to retry.')}`,
    );
  } else {
    console.log(`\n${pick(language, '初始化完成。', 'Initialization complete.')}`);
  }
}

function modeLabel(mode: InitReport['mode'], language: Language): string {
  const map: Record<InitReport['mode'], [string, string]> = {
    workspace: ['workspace', 'workspace'],
    'workspace-reuse': ['复用 workspace', 'reuse workspace'],
    'single-repo': ['单仓', 'single repository'],
    'new-project': ['新项目', 'new project'],
  };
  return pick(language, ...map[mode]);
}

function phaseLabel(label: string, language: Language): string {
  if (language === 'zh') return label;
  const map: Record<string, string> = {
    项目计划: 'Project plan',
    '初始化 Git 仓库': 'Initialize Git repositories',
    'OpenIssue 产品': 'OpenIssue product',
    '本机锚点注册': 'Register local anchor',
    'OpenSpec 初始化': 'Initialize OpenSpec',
    '提升 OpenSpec skills': 'Promote OpenSpec skills',
    '写入 workspace 指针': 'Write workspace pointer',
    '复用 workspace 指针': 'Reuse workspace pointer',
    '登记成员仓库': 'Register member repositories',
    '安装 OpenIssue skills': 'Install OpenIssue skills',
    'spec 仓 AGENTS': 'Spec repository AGENTS',
    'workspace AGENTS 索引': 'Workspace AGENTS index',
    '自动登记代码仓': 'Register code repository',
  };
  return map[label] ?? label;
}

function pick(language: Language, zh: string, en: string): string {
  return language === 'zh' ? zh : en;
}
