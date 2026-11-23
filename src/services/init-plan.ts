import { spawnSync } from 'node:child_process';
import path from 'node:path';
import type { Language, LanguageSource } from '../core/language.js';
import { toPosix } from '../core/paths.js';
import { statusSkills } from '../skills/install.js';
import { hasCompleteOpenspecData } from '../storage/openspec.js';
import { readProduct, productExists } from '../storage/product.js';
import {
  findGitRoot,
  findWorkspacePointerRoot,
  readWorkspacePointer,
  validateWorkspacePointer,
  workspacePointerPath,
  type WorkspacePointer,
} from '../storage/workspace.js';
import {
  buildMemberCandidates,
  normalizeProjectName,
  resolveExistingAnchorIdentity,
  runInit,
  scanDirectChildGitRepos,
  scanWorkspace,
  type AnchorCandidate,
  type InitMode,
  type InitOptions,
  type InitReport,
  type MemberCandidate,
  type ScanResult,
} from './workspace-init.js';

export interface InitPlanMember {
  path: string;
  id: string;
  status: MemberCandidate['status'];
  preselected: boolean;
  selected: boolean;
  reason?: string;
}

export interface InitPlanWrite {
  path: string;
  action: 'create' | 'update' | 'reuse' | 'skip';
  label: string;
  kind?: 'skills' | 'openspec' | 'member' | 'pointer' | 'product' | 'agents';
}

export interface InitPlan {
  mode: InitMode;
  workspace_root: string;
  mode_reason: string;
  available_modes: InitMode[];
  requires_anchor_selection: boolean;
  blocked_code?: string;
  blocked_reason?: string;
  anchor_root?: string;
  product?: { id: string; name: string };
  code_root?: string;
  spec_root?: string;
  pointer?: { path: string; reused: boolean; anchor: string; product: string };
  anchors: Array<{
    path: string;
    kind: 'openissue' | 'openspec';
    product?: { id: string; name: string };
    reason: string;
  }>;
  members: InitPlanMember[];
  openspec: {
    ready: boolean;
    cli_available: boolean;
    initialize?: boolean;
    needs_choice: boolean;
    reason?: string;
  };
  skills: {
    install: boolean;
    target: string;
    conflicts: Array<{ path: string; state: string }>;
  };
  language: Language;
  language_source?: LanguageSource;
  writes: InitPlanWrite[];
  warnings: string[];
  next: string[];
  options: InitOptions;
}

export interface PlanOverrides {
  forceMode?: InitMode;
  anchorPath?: string;
  name?: string;
  memberPaths?: string[];
  openspec?: boolean;
}

export async function buildInitPlan(
  options: InitOptions,
  overrides: PlanOverrides = {},
): Promise<InitPlan> {
  const cwd = path.resolve(options.cwd);
  const language = options.language;
  const plan = emptyPlan(cwd, options, language);

  if (await productExists(cwd)) {
    return blocked(
      plan,
      'ALREADY_INITIALIZED',
      text(language, '当前目录已经是 OpenIssue 锚点仓库。', 'The current directory is already an OpenIssue anchor repository.'),
    );
  }

  const pointerRoot = await findWorkspacePointerRoot(cwd);
  if (pointerRoot && path.resolve(pointerRoot) !== cwd) {
    return blocked(
      plan,
      'WORKSPACE_ROOT_REQUIRED',
      text(
        language,
        `当前目录不是 workspace 根；请到 ${pointerRoot} 运行。`,
        `The current directory is not the workspace root; run from ${pointerRoot}.`,
      ),
    );
  }

  let pointer: Awaited<ReturnType<typeof readWorkspacePointer>> | null = null;
  try {
    pointer = await readWorkspacePointer(cwd);
  } catch (error) {
    if (!options.rescan && !options.anchorPath && !overrides.forceMode) {
      return blocked(plan, 'WORKSPACE_POINTER_INVALID', messageOf(error));
    }
  }

  const forceMode = overrides.forceMode;
  if (
    pointer &&
    !options.rescan &&
    !options.anchorPath &&
    (!forceMode || forceMode === 'workspace-reuse')
  ) {
    try {
      return await reusePlan(cwd, pointer, options, plan);
    } catch (error) {
      if (!options.rescan && !options.anchorPath && !forceMode) {
        return blocked(plan, 'WORKSPACE_POINTER_INVALID', messageOf(error));
      }
    }
  }

  const gitRoot = await findGitRoot(cwd);
  if (gitRoot && path.resolve(gitRoot) !== cwd) {
    return blocked(
      plan,
      'NESTED_GIT_REPOSITORY',
      text(
        language,
        `当前目录位于 Git 仓内部，不是仓根：${gitRoot}。`,
        `The current directory is inside a Git repository, not the repository root: ${gitRoot}.`,
      ),
    );
  }

  const directGitRepos = await scanDirectChildGitRepos(cwd);
  if ((!forceMode || forceMode === 'single-repo') && gitRoot && directGitRepos.length === 0) {
    return singleRepoPlan(cwd, options, plan);
  }

  const scan = await scanWorkspace(cwd);
  if (scan.anchors.length === 0) {
    if (scan.directGitRepos.length > 0) {
      return blocked(
        plan,
        'ANCHOR_REQUIRED',
        text(
          language,
          `当前 workspace 有直接子 Git 仓但没有锚点：${scan.directGitRepos
            .map((repo) => toPosix(path.relative(cwd, repo)))
            .join('、')}。请用 --anchor 指定锚点，或取消初始化。`,
          `The workspace has direct Git repositories but no anchor: ${scan.directGitRepos
            .map((repo) => toPosix(path.relative(cwd, repo)))
            .join(', ')}. Specify --anchor or cancel.`,
        ),
      );
    }
    if (!options.newProject && !forceMode && scan.ordinary.length > 0) {
      return blocked(
        plan,
        'WORKSPACE_NOT_EMPTY',
        text(
          language,
          `当前 workspace 有普通内容：${scan.ordinary.join('、')}。请明确选择新建项目，或指定其他目录。`,
          `The workspace contains ordinary content: ${scan.ordinary.join(', ')}. Choose a new project explicitly or use another directory.`,
        ),
      );
    }
    return newProjectPlan(cwd, options, plan, overrides, scan.ordinary);
  }

  return workspacePlan(cwd, options, plan, scan.anchors, scan, overrides);
}

export async function executeInitPlan(plan: InitPlan): Promise<InitReport> {
  const selected =
    plan.mode === 'workspace-reuse'
      ? []
      : plan.members.filter((member) => member.selected && member.status !== 'conflict');
  const options: InitOptions = {
    ...plan.options,
    cwd: plan.workspace_root,
    anchorPath: plan.mode === 'workspace' ? plan.anchor_root : undefined,
    name: plan.mode === 'new-project' ? plan.product?.name : plan.options.name,
    newProject: plan.mode === 'new-project',
    memberPaths: selected.map((member) => member.path),
    skipMembers: selected.length === 0,
    openspec: plan.openspec.ready ? false : plan.openspec.initialize,
    skills: plan.skills.install ? plan.options.skills : [],
    yes: true,
    interactive: false,
    language: plan.language,
  };
  const report = await runInit(options);
  report.language = plan.language;
  report.language_source = plan.options.languageSource;
  return report;
}

async function reusePlan(
  cwd: string,
  pointer: WorkspacePointer,
  options: InitOptions,
  plan: InitPlan,
): Promise<InitPlan> {
  const resolved = await validateWorkspacePointer(pointer);
  const ready = await hasCompleteOpenspecData(resolved.anchorRoot);
  const skills = await skillPlan(cwd, options);
  plan.mode = 'workspace-reuse';
  plan.mode_reason = text(
    options.language,
    `复用 workspace 指针：${pointer.path}`,
    `Reuse workspace pointer: ${pointer.path}`,
  );
  plan.available_modes = ['workspace-reuse'];
  plan.anchor_root = resolved.anchorRoot;
  plan.product = { id: resolved.product.id, name: resolved.product.name };
  plan.pointer = {
    path: pointer.path,
    reused: true,
    anchor: pointer.anchor,
    product: pointer.product,
  };
  plan.members = resolved.product.members.map((member) => ({
    path: path.join(cwd, member.id),
    id: member.id,
    status: 'existing',
    preselected: true,
    selected: true,
    reason: text(options.language, '已登记成员', 'existing member'),
  }));
  plan.openspec = await openspecPlan(ready, options, resolved.anchorRoot);
  plan.skills = skills;
  plan.writes = [
    { path: pointer.path, action: 'reuse', label: text(options.language, 'workspace 指针', 'workspace pointer') },
    ...(skills.install
      ? [{ path: skills.target, action: 'update' as const, label: text(options.language, '共享 skills', 'shared skills') }]
      : []),
    ...(plan.openspec.initialize
      ? [{ path: path.join(resolved.anchorRoot, 'openspec'), action: 'create' as const, label: 'OpenSpec', kind: 'openspec' as const }]
      : []),
  ];
  plan.next.push('openissue list', 'openissue skills status');
  return plan;
}

async function singleRepoPlan(
  cwd: string,
  options: InitOptions,
  plan: InitPlan,
): Promise<InitPlan> {
  const identity = resolveExistingAnchorIdentity(cwd, options);
  const ready = await hasCompleteOpenspecData(cwd);
  const skills = await skillPlan(cwd, options);
  plan.mode = 'single-repo';
  plan.mode_reason = text(
    options.language,
    '当前目录是单 Git 仓，将原地初始化。',
    'The current directory is a single Git repository; initialize it in place.',
  );
  plan.available_modes = ['single-repo', 'new-project'];
  plan.anchor_root = cwd;
  plan.product = identity;
  plan.openspec = await openspecPlan(ready, options, cwd);
  plan.skills = skills;
  plan.writes = [
    { path: path.join(cwd, 'openissue'), action: 'create', label: 'OpenIssue data' },
    ...(skills.install
      ? [{ path: skills.target, action: 'update' as const, label: 'skills', kind: 'skills' as const }]
      : []),
    ...(plan.openspec.initialize
      ? [{ path: path.join(cwd, 'openspec'), action: 'create' as const, label: 'OpenSpec', kind: 'openspec' as const }]
      : []),
  ];
  plan.next.push('openissue list', 'openissue skills status');
  return plan;
}

async function newProjectPlan(
  cwd: string,
  options: InitOptions,
  plan: InitPlan,
  overrides: PlanOverrides,
  ordinary: string[],
): Promise<InitPlan> {
  const inputName = overrides.name?.trim() || options.name?.trim() || '';
  if (!inputName) {
    return blocked(
      plan,
      'PROJECT_NAME_REQUIRED',
      text(
        options.language,
        '全新项目需要英文项目名。请追加 --name <name>。',
        'A new project requires an English name; add --name <name>.',
      ),
    );
  }
  let id: string;
  try {
    id = normalizeProjectName(inputName);
  } catch (error) {
    return blocked(plan, 'INVALID_PROJECT_NAME', messageOf(error));
  }
  const displayName = inputName.trim();
  const codeRoot = path.join(cwd, id);
  const specRoot = path.join(cwd, `${id}-spec`);
  const skills = await skillPlan(cwd, options);
  plan.mode = 'new-project';
  plan.mode_reason = ordinary.length
    ? text(
        options.language,
        `workspace 有普通内容：${ordinary.join('、')}，将新建项目。`,
        `The workspace has ordinary content: ${ordinary.join(', ')}; create a new project.`,
      )
    : text(
        options.language,
        '空 workspace，将新建代码仓与 spec/issue 仓。',
        'Empty workspace; create a code repository and a spec/issue repository.',
      );
  plan.available_modes = ['new-project', 'single-repo'];
  plan.anchor_root = specRoot;
  plan.product = { id, name: displayName };
  plan.code_root = codeRoot;
  plan.spec_root = specRoot;
  plan.openspec = await openspecPlan(false, options, specRoot);
  plan.skills = skills;
  plan.writes = [
    { path: codeRoot, action: 'create', label: 'code repository' },
    { path: specRoot, action: 'create', label: 'spec repository' },
    { path: path.join(codeRoot, 'README.md'), action: 'create', label: 'code README' },
    { path: path.join(codeRoot, '.gitignore'), action: 'create', label: '.gitignore' },
    { path: path.join(codeRoot, 'AGENTS.md'), action: 'create', label: 'code AGENTS' },
    { path: path.join(specRoot, 'openissue'), action: 'create', label: 'OpenIssue data' },
    { path: path.join(specRoot, 'README.md'), action: 'create', label: 'spec README' },
    { path: path.join(specRoot, 'AGENTS.md'), action: 'create', label: 'spec AGENTS' },
    { path: path.join(cwd, 'AGENTS.md'), action: 'update', label: 'workspace AGENTS' },
    {
      path: workspacePointerPath(cwd),
      action: 'create',
      label: 'workspace pointer',
    },
    ...(skills.install
      ? [{ path: skills.target, action: 'update' as const, label: 'skills', kind: 'skills' as const }]
      : []),
    ...(plan.openspec.initialize
      ? [{ path: path.join(specRoot, 'openspec'), action: 'create' as const, label: 'OpenSpec', kind: 'openspec' as const }]
      : []),
  ];
  plan.next.push(
    `git -C ${codeRoot} add .`,
    `git -C ${specRoot} add .`,
    'openissue list',
  );
  return plan;
}

async function workspacePlan(
  cwd: string,
  options: InitOptions,
  plan: InitPlan,
  anchors: AnchorCandidate[],
  scan: ScanResult,
  overrides: PlanOverrides,
): Promise<InitPlan> {
  const requested = overrides.anchorPath ?? options.anchorPath;
  let anchor = requested
    ? anchors.find((candidate) => path.resolve(candidate.root) === path.resolve(cwd, requested))
    : anchors.length === 1
      ? anchors[0]
      : undefined;

  if (!anchor && requested) {
    if (await productExists(path.resolve(cwd, requested))) {
      anchor = {
        root: path.resolve(cwd, requested),
        kind: 'openissue',
        product: await readProduct(path.resolve(cwd, requested)),
        reason: 'explicit',
        storeIds: [],
      };
    } else if (await hasCompleteOpenspecData(path.resolve(cwd, requested))) {
      anchor = {
        root: path.resolve(cwd, requested),
        kind: 'openspec' as const,
        product: undefined,
        reason: 'explicit',
        storeIds: [],
      };
    }
  }

  if (!anchor) {
    plan.mode = 'workspace';
    plan.mode_reason = text(
      options.language,
      '发现多个锚点候选，需要先选择。',
      'Multiple anchor candidates found; choose one first.',
    );
    plan.available_modes = ['workspace', 'new-project'];
    plan.requires_anchor_selection = true;
    plan.anchors = anchors.map((candidate) => ({
      path: candidate.root,
      kind: candidate.kind,
      ...(candidate.product
        ? { product: { id: candidate.product.id, name: candidate.product.name } }
        : {}),
      reason: candidate.reason,
    }));
    return plan;
  }

  const existing = anchor.product ?? undefined;
  const productId = existing?.id ?? fallbackId(anchor.root, options.id);
  const ready = await hasCompleteOpenspecData(anchor.root);
  const members = await buildMemberCandidates(
    cwd,
    anchor.root,
    scan.directGitRepos,
    productId,
  );
  const selected = selectMembers(members, options, overrides);
  const skills = await skillPlan(cwd, options);

  plan.mode = 'workspace';
  plan.mode_reason = text(
    options.language,
    `发现锚点：${toPosix(path.relative(cwd, anchor.root))}（${anchor.reason}）。`,
    `Anchor found: ${toPosix(path.relative(cwd, anchor.root))} (${anchor.reason}).`,
  );
  plan.available_modes = ['workspace', 'new-project'];
  plan.anchor_root = anchor.root;
  plan.product = {
    id: productId,
    name: existing?.name ?? options.name?.trim() ?? productId,
  };
  plan.anchors = anchors.map((candidate) => ({
    path: candidate.root,
    kind: candidate.kind,
    ...(candidate.product
      ? { product: { id: candidate.product.id, name: candidate.product.name } }
      : {}),
    reason: candidate.reason,
  }));
  plan.members = members.map((candidate) => ({
    path: candidate.root,
    id: candidate.id,
    status: candidate.status,
    preselected: candidate.preselected,
    selected: selected.has(path.resolve(candidate.root)),
    ...(candidate.reason ? { reason: candidate.reason } : {}),
  }));
  plan.openspec = await openspecPlan(ready, options, anchor.root);
  plan.skills = skills;
  plan.writes = [
    {
      path: workspacePointerPath(cwd),
      action: 'create',
      label: 'workspace pointer',
      kind: 'pointer',
    },
    {
      path: path.join(anchor.root, 'openissue', 'product.yaml'),
      action: existing ? 'reuse' : 'create',
      label: 'OpenIssue product',
    },
    ...plan.members
      .filter((member) => member.selected)
      .map((member) => ({
        path: path.join(member.path, 'openissue-project.yaml'),
        action: 'create' as const,
        label: 'member pointer',
        kind: 'member' as const,
      })),
    ...(skills.install
      ? [{ path: skills.target, action: 'update' as const, label: 'skills', kind: 'skills' as const }]
      : []),
    ...(plan.openspec.initialize
      ? [{ path: path.join(anchor.root, 'openspec'), action: 'create' as const, label: 'OpenSpec', kind: 'openspec' as const }]
      : []),
    { path: path.join(cwd, 'AGENTS.md'), action: 'update', label: 'workspace AGENTS' },
  ];
  plan.next.push('openissue list', 'openissue skills status');
  return plan;
}

async function openspecPlan(
  ready: boolean,
  options: InitOptions,
  _root: string,
): Promise<InitPlan['openspec']> {
  const cliAvailable = openspecCliAvailable();
  if (ready) {
    return { ready: true, cli_available: cliAvailable, initialize: false, needs_choice: false };
  }
  if (!cliAvailable) {
    return {
      ready: false,
      cli_available: false,
      initialize: false,
      needs_choice: false,
      reason: text(
        options.language,
        'OpenSpec CLI 不可用；可稍后安装并运行 openspec init。',
        'The OpenSpec CLI is unavailable; install it and run openspec init later.',
      ),
    };
  }
  if (options.openspec === false) {
    return {
      ready: false,
      cli_available: true,
      initialize: false,
      needs_choice: false,
      reason: text(options.language, '用户选择暂不初始化', 'User chose not to initialize'),
    };
  }
  if (options.openspec === true || options.yes) {
    return { ready: false, cli_available: true, initialize: true, needs_choice: false };
  }
  return {
    ready: false,
    cli_available: true,
    needs_choice: true,
    reason: text(
      options.language,
      'OpenSpec 尚未初始化，请选择现在初始化或暂不初始化。',
      'OpenSpec is not initialized; choose initialize now or later.',
    ),
  };
}

function openspecCliAvailable(): boolean {
  const bin = process.platform === 'win32' ? 'openspec.cmd' : 'openspec';
  const result = spawnSync(bin, ['--version'], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  return !result.error && result.status === 0;
}

async function skillPlan(cwd: string, options: InitOptions): Promise<InitPlan['skills']> {
  const target = path.join(cwd, '.agents', 'skills');
  if (options.skills.length === 0) {
    return { install: false, target, conflicts: [] };
  }
  const statuses = await statusSkills(cwd, options.skills);
  const conflicts = statuses.flatMap((status) =>
    status.skills
      .filter((skill) => skill.state === 'modified' || skill.state === 'unmanaged')
      .map((skill) => ({ path: skill.path, state: skill.state })),
  );
  return { install: true, target, conflicts };
}

function selectMembers(
  candidates: MemberCandidate[],
  options: InitOptions,
  overrides: PlanOverrides,
): Set<string> {
  if (options.skipMembers) return new Set();
  const requested = overrides.memberPaths ?? options.memberPaths;
  if (requested.length > 0) {
    return new Set(requested.map((item) => path.resolve(options.cwd, item)));
  }
  if (options.yes) {
    return new Set(
      candidates
        .filter((candidate) => candidate.preselected && candidate.status !== 'conflict')
        .map((candidate) => path.resolve(candidate.root)),
    );
  }
  return new Set(
    candidates
      .filter((candidate) => candidate.preselected && candidate.status !== 'conflict')
      .map((candidate) => path.resolve(candidate.root)),
  );
}

function fallbackId(anchorRoot: string, requested: string | undefined): string {
  const id = requested?.trim() || path.basename(anchorRoot).toLowerCase().replace(/[^a-z0-9-]+/g, '-');
  return id.replace(/^-+|-+$/g, '') || 'openissue-product';
}

function emptyPlan(cwd: string, options: InitOptions, language: Language): InitPlan {
  return {
    mode: 'workspace',
    workspace_root: cwd,
    mode_reason: '',
    available_modes: ['workspace', 'single-repo', 'new-project'],
    requires_anchor_selection: false,
    anchors: [],
    members: [],
    openspec: { ready: false, cli_available: false, needs_choice: true },
    skills: { install: options.skills.length > 0, target: path.join(cwd, '.agents', 'skills'), conflicts: [] },
    language,
    ...(options.languageSource ? { language_source: options.languageSource } : {}),
    writes: [],
    warnings: [],
    next: [],
    options,
  };
}

function blocked(plan: InitPlan, code: string, reason: string): InitPlan {
  plan.blocked_code = code;
  plan.blocked_reason = reason;
  plan.writes = [];
  return plan;
}

function text(language: Language, zh: string, en: string): string {
  return language === 'zh' ? zh : en;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
