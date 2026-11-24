import { spawnSync } from 'node:child_process';
import { access, mkdir, readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { OpenIssueError } from '../core/errors.js';
import { slugifyTitle } from '../core/id.js';
import type { Language, LanguageSource } from '../core/language.js';
import { toPosix } from '../core/paths.js';
import type { ProductManifest } from '../core/types.js';
import type { SkillTool } from '../skills/catalog.js';
import {
  installSkills,
  promoteSkillsDirectory,
  summarizeInstall,
} from '../skills/install.js';
import { writeTextAtomic } from '../storage/atomic.js';
import {
  hasCompleteOpenspecData,
  readAnchorStoreIds,
  readStorePointer,
  runOpenspecInit,
} from '../storage/openspec.js';
import { initProduct, productExists, readProduct } from '../storage/product.js';
import { registerAnchor } from '../storage/registry.js';
import {
  MEMBER_FILE,
  WORKSPACE_FILE,
  findGitRoot,
  findWorkspacePointerRoot,
  readMemberPointer,
  readWorkspacePointer,
  registerRepository,
  resolvePointerAnchor,
  validateWorkspacePointer,
  workspacePointerPath,
  writeWorkspacePointer,
  type WorkspacePointer,
} from '../storage/workspace.js';

export const AGENTS_START = '<!-- OPENISSUE:START -->';
export const AGENTS_END = '<!-- OPENISSUE:END -->';

export type InitMode = 'workspace' | 'workspace-reuse' | 'single-repo' | 'new-project';
export type InitPhaseStatus = 'success' | 'failed' | 'skipped' | 'not-run';

export interface InitPhase {
  id: string;
  label: string;
  status: InitPhaseStatus;
  message?: string;
}

export interface InitMemberResult {
  id: string;
  path: string;
  status: 'registered' | 'failed' | 'conflict';
  reason?: string;
}

export interface InitAnchorCandidateJson {
  path: string;
  kind: 'openissue' | 'openspec';
  store_pointer?: string;
}

export interface InitMemberCandidateJson {
  path: string;
  preselected: boolean;
  conflict?: string;
}

export interface InitReport {
  mode: InitMode;
  status: 'success' | 'partial' | 'failed';
  workspace_root: string;
  anchor_root: string | undefined;
  product: { id: string; name: string } | undefined;
  code_root: string | undefined;
  spec_root: string | undefined;
  pointer:
    | { path: string; reused: boolean; anchor: string; product: string }
    | undefined;
  candidates:
    | {
        anchors: InitAnchorCandidateJson[];
        members: InitMemberCandidateJson[];
        store_pointers: Array<{ path: string; store: string }>;
      }
    | undefined;
  members: InitMemberResult[];
  phases: InitPhase[];
  warnings: string[];
  next: string[];
  language: Language;
  language_source: LanguageSource | undefined;
  created: string[];
  error: { code: string; message: string } | undefined;
}

export interface InitOptions {
  cwd: string;
  id: string | undefined;
  name: string | undefined;
  anchorPath: string | undefined;
  skills: SkillTool[];
  newProject: boolean | undefined;
  yes: boolean | undefined;
  memberPaths: string[];
  skipMembers: boolean | undefined;
  openspec: boolean | undefined;
  rescan: boolean | undefined;
  force: boolean | undefined;
  language: Language;
  languageSource?: LanguageSource;
  interactive: boolean;
}

export interface AnchorCandidate {
  root: string;
  kind: 'openissue' | 'openspec';
  product: ProductManifest | undefined;
  reason: string;
  storeIds: string[];
}

export interface MemberCandidate {
  root: string;
  id: string;
  status: 'candidate' | 'existing' | 'conflict' | 'invalid';
  preselected: boolean;
  reason: string | undefined;
}

export interface ScanResult {
  anchors: AnchorCandidate[];
  excluded: Array<{ path: string; store: string }>;
  directGitRepos: string[];
  ordinary: string[];
}

interface MemberSelection {
  candidate: MemberCandidate;
}

export async function runInit(options: InitOptions): Promise<InitReport> {
  const cwd = path.resolve(options.cwd);
  if (await productExists(cwd)) {
    throw new OpenIssueError('当前目录已经是 OpenIssue 锚点仓库', 'ALREADY_INITIALIZED');
  }

  const pointerRoot = await findWorkspacePointerRoot(cwd);
  if (pointerRoot && path.resolve(pointerRoot) !== cwd) {
    throw new OpenIssueError(
      `当前目录不是 workspace 根；请到 ${pointerRoot} 运行 openissue init。`,
      'WORKSPACE_ROOT_REQUIRED',
    );
  }

  let pointer: WorkspacePointer | null = null;
  try {
    pointer = await readWorkspacePointer(cwd);
  } catch (error) {
    if (!options.rescan && !options.anchorPath) throw error;
  }

  if (pointer && !options.rescan && !options.anchorPath) {
    try {
      const report = emptyReport(cwd, 'workspace-reuse', options.language);
      return await reuseWorkspace(cwd, pointer, options, report);
    } catch (error) {
      if (!options.rescan && !options.anchorPath) throw error;
    }
  }

  const gitRoot = await findGitRoot(cwd);
  if (gitRoot && path.resolve(gitRoot) !== cwd) {
    throw new OpenIssueError(
      `当前目录位于 Git 仓内部，不是仓根：${gitRoot}。请到仓根运行，或用 --anchor <path> 指定锚点。`,
      'NESTED_GIT_REPOSITORY',
    );
  }

  const directGitRepos = await scanDirectChildGitRepos(cwd);
  if (gitRoot && directGitRepos.length === 0) {
    return await initSingleRepo(cwd, options);
  }

  const scan = await scanWorkspace(cwd);
  const report = emptyReport(cwd, 'workspace', options.language);
  report.candidates = {
    anchors: scan.anchors.map((candidate) => ({
      path: candidate.root,
      kind: candidate.kind,
    })),
    members: [],
    store_pointers: scan.excluded.map((item) => ({ path: item.path, store: item.store })),
  };

  if (scan.anchors.length === 0) {
    if (directGitRepos.length > 0) {
      throw new OpenIssueError(
        `当前 workspace 有直接子 Git 仓但没有 OpenIssue/OpenSpec 锚点：${directGitRepos
          .map((repo) => toPosix(path.relative(cwd, repo)))
          .join('、')}。请用 --anchor <path> 指定锚点，或取消初始化。`,
        'ANCHOR_REQUIRED',
      );
    }
    if (!options.newProject && !(await isKnownEmptyWorkspace(cwd))) {
      const ordinary = await ordinaryWorkspaceEntries(cwd);
      throw new OpenIssueError(
        `当前 workspace 有普通内容：${ordinary.join('、')}。请明确选择 --new 在此新建项目，或指定其他目录/取消。`,
        'WORKSPACE_NOT_EMPTY',
      );
    }
    return await initNewProject(cwd, options, report);
  }

  const anchor = await selectAnchor(cwd, scan.anchors, options);
  return await initWorkspace(cwd, anchor, scan, options, report);
}

async function reuseWorkspace(
  workspaceRoot: string,
  pointer: WorkspacePointer,
  options: InitOptions,
  report: InitReport,
): Promise<InitReport> {
  const resolved = await validateWorkspacePointer(pointer);
  report.anchor_root = resolved.anchorRoot;
  report.product = { id: resolved.product.id, name: resolved.product.name };
  report.pointer = {
    path: pointer.path,
    reused: true,
    anchor: pointer.anchor,
    product: pointer.product,
  };
  phase(report, 'pointer', '复用 workspace 指针', 'success', `锚点：${resolved.anchorRoot}`);

  if (!(await hasCompleteOpenspecData(resolved.anchorRoot))) {
    const shouldInit = await shouldInitializeOpenspec(resolved.anchorRoot, options, 'workspace');
    if (shouldInit) {
      await initializeOpenspec(resolved.anchorRoot, workspaceRoot, options, report);
    } else {
      phase(report, 'openspec', 'OpenSpec 初始化', 'skipped', '用户选择暂不初始化');
      report.warnings.push('OpenSpec 尚未初始化；可稍后在锚点运行 openspec init。');
    }
  } else {
    phase(report, 'openspec', 'OpenSpec 检查', 'skipped', '锚点已包含 OpenSpec');
  }

  if (options.memberPaths.length > 0) {
    const directGitRepos = await scanDirectChildGitRepos(workspaceRoot);
    const candidates = await buildMemberCandidates(
      workspaceRoot,
      resolved.anchorRoot,
      directGitRepos,
      resolved.product.id,
    );
    const selected = await selectMembers(workspaceRoot, candidates, options);
    await registerMembers(resolved.anchorRoot, resolved.product, selected, report);
  }

  await installBundledSkills(workspaceRoot, options, report);
  const memberRoots = await resolveMemberRoots(workspaceRoot, resolved.anchorRoot, resolved.product);
  await updateRootAgents(workspaceRoot, resolved.anchorRoot, memberRoots, report);
  report.next.push('openissue list', 'openissue skills status');
  return finalize(report);
}

async function initSingleRepo(
  root: string,
  options: InitOptions,
): Promise<InitReport> {
  const report = emptyReport(root, 'single-repo', options.language);
  const identity = resolveExistingAnchorIdentity(root, options);
  const openspecReady = await hasCompleteOpenspecData(root);
  const shouldInit = openspecReady
    ? false
    : await shouldInitializeOpenspec(root, options, 'single-repo');
  const product = await ensureProduct(root, identity, report);
  report.anchor_root = root;
  report.product = { id: product.id, name: product.name };
  await registerProduct(product, root, report);

  if (openspecReady) {
    phase(report, 'openspec', 'OpenSpec 检查', 'skipped', '当前仓已包含 OpenSpec');
  } else if (shouldInit) {
    await initializeOpenspec(root, root, options, report);
  } else {
    phase(report, 'openspec', 'OpenSpec 初始化', 'skipped', '用户选择暂不初始化');
    report.warnings.push('OpenSpec 尚未初始化；可稍后运行 openspec init。');
  }

  await installBundledSkills(root, options, report);
  report.next.push('openissue list', 'openissue skills status');
  return finalize(report);
}

async function initWorkspace(
  workspaceRoot: string,
  anchor: AnchorCandidate,
  scan: ScanResult,
  options: InitOptions,
  report: InitReport,
): Promise<InitReport> {
  const existing = anchor.product;
  const expectedId = existing?.id ?? fallbackProductId(anchor.root, options.id);
  if (existing && options.id?.trim() && existing.id !== options.id.trim()) {
    throw new OpenIssueError(
      `锚点产品标识是 ${existing.id}，与 --id ${options.id.trim()} 不一致`,
      'PRODUCT_MISMATCH',
    );
  }
  if (!existing) {
    const confirmed = await confirm(
      `将在 ${toPosix(path.relative(workspaceRoot, anchor.root) || '.')} 创建 OpenIssue 数据，继续？`,
      options,
    );
    if (!confirmed) {
      throw new OpenIssueError('已取消在 OpenSpec 仓创建 OpenIssue 数据。', 'INIT_CANCELLED');
    }
  }

  const directGitRepos = await scanDirectChildGitRepos(workspaceRoot);
  const candidates = await buildMemberCandidates(
    workspaceRoot,
    anchor.root,
    directGitRepos,
    expectedId,
  );
  report.candidates = {
    anchors: scan.anchors.map((candidate) => ({
      path: candidate.root,
      kind: candidate.kind,
    })),
    members: candidates.map((candidate) => ({
      path: candidate.root,
      preselected: candidate.preselected,
      ...(candidate.status === 'conflict' && candidate.reason
        ? { conflict: candidate.reason }
        : {}),
    })),
    store_pointers: scan.excluded.map((item) => ({ path: item.path, store: item.store })),
  };

  const selected = await selectMembers(workspaceRoot, candidates, options);
  const openspecReady = await hasCompleteOpenspecData(anchor.root);
  const shouldInit = openspecReady
    ? false
    : await shouldInitializeOpenspec(anchor.root, options, 'workspace');

  const product = await ensureProduct(
    anchor.root,
    existing
      ? { id: existing.id, name: existing.name }
      : { id: expectedId, name: options.name?.trim() || expectedId },
    report,
  );
  report.anchor_root = anchor.root;
  report.product = { id: product.id, name: product.name };
  await registerProduct(product, anchor.root, report);

  try {
    const pointer = await writeWorkspacePointer(workspaceRoot, product.id, anchor.root);
    report.pointer = {
      path: pointer.path,
      reused: false,
      anchor: pointer.anchor,
      product: pointer.product,
    };
    phase(report, 'pointer', '写入 workspace 指针', 'success', pointer.path);
  } catch (error) {
    phase(
      report,
      'pointer',
      '写入 workspace 指针',
      'failed',
      messageOf(error),
    );
    report.warnings.push(`workspace 指针写入失败：${messageOf(error)}`);
  }

  await registerMembers(anchor.root, product, selected, report);
  for (const candidate of candidates) {
    if (candidate.status === 'conflict') {
      report.members.push({
        id: candidate.id,
        path: candidate.root,
        status: 'conflict',
        ...(candidate.reason ? { reason: candidate.reason } : {}),
      });
    }
  }

  if (openspecReady) {
    phase(report, 'openspec', 'OpenSpec 检查', 'skipped', '锚点已包含 OpenSpec');
  } else if (shouldInit) {
    await initializeOpenspec(anchor.root, workspaceRoot, options, report);
  } else {
    phase(report, 'openspec', 'OpenSpec 初始化', 'skipped', '用户选择暂不初始化');
    report.warnings.push('OpenSpec 尚未初始化；可稍后在锚点运行 openspec init。');
  }

  await installBundledSkills(workspaceRoot, options, report);
  await updateRootAgents(
    workspaceRoot,
    anchor.root,
    selected.map((item) => item.candidate.root),
    report,
  );
  report.next.push('openissue list', 'openissue skills status');
  return finalize(report);
}

async function initNewProject(
  workspaceRoot: string,
  options: InitOptions,
  report: InitReport,
): Promise<InitReport> {
  const inputName = await resolveProjectName(options);
  const id = normalizeProjectName(inputName);
  const displayName = inputName.trim();
  const codeRoot = path.join(workspaceRoot, id);
  const specRoot = path.join(workspaceRoot, `${id}-spec`);

  const codeExists = await exists(codeRoot);
  const specExists = await exists(specRoot);
  if (codeExists || specExists) {
    const resumable =
      (await exists(path.join(specRoot, 'openissue', 'product.yaml'))) ||
      (await exists(path.join(codeRoot, 'openissue-project.yaml')));
    if (!resumable || !options.yes) {
      throw new OpenIssueError(
        `目标目录已存在：${[codeExists ? toPosix(path.relative(workspaceRoot, codeRoot)) : '', specExists ? toPosix(path.relative(workspaceRoot, specRoot)) : '']
          .filter(Boolean)
          .join('、')}。请修改项目名，或确认恢复中断的初始化。`,
        'INIT_DIRECTORY_CONFLICT',
      );
    }
  }

  if (!options.yes) {
    const confirmed = await confirm(
      `将在当前 workspace 创建代码仓 ${id}/ 与 spec 仓 ${id}-spec/，继续？`,
      options,
    );
    if (!confirmed) throw new OpenIssueError('已取消新项目创建。', 'INIT_CANCELLED');
  }

  report.mode = 'new-project';
  report.product = { id, name: displayName };
  report.code_root = codeRoot;
  report.spec_root = specRoot;
  report.anchor_root = specRoot;
  phase(report, 'plan', '项目计划', 'success', `${id}/ + ${id}-spec/`);

  await mkdir(codeRoot, { recursive: true });
  await mkdir(specRoot, { recursive: true });

  const codeGit = await ensureGitRepo(codeRoot);
  const specGit = await ensureGitRepo(specRoot);
  if (codeGit.ok && specGit.ok) {
    phase(report, 'git', '初始化 Git 仓库', 'success', '两个仓库均已 git init，未创建提交');
  } else {
    const message = [codeGit.message, specGit.message].filter(Boolean).join('；');
    phase(report, 'git', '初始化 Git 仓库', 'failed', message);
    report.warnings.push(`Git 初始化未完成：${message}`);
    report.next.push(`在 ${codeRoot} 运行 git init`);
    report.next.push(`在 ${specRoot} 运行 git init`);
  }

  const product = await ensureProduct(specRoot, { id, name: displayName }, report);
  report.product = { id: product.id, name: product.name };
  await registerProduct(product, specRoot, report);
  await ensureGeneratedFile(
    path.join(specRoot, 'README.md'),
    specReadme(product.id),
    options.force,
    report,
    'spec-readme',
    'spec 仓 README',
  );

  if (options.openspec === false) {
    phase(report, 'openspec', 'OpenSpec 初始化', 'skipped', '用户选择暂不初始化');
    report.warnings.push('OpenSpec 尚未初始化；可稍后在 spec 仓运行 openspec init。');
  } else {
    await initializeOpenspec(specRoot, workspaceRoot, options, report);
  }
  await ensureSpecAgents(specRoot, product, options, report);
  await ensureGeneratedFile(
    path.join(codeRoot, 'README.md'),
    codeReadme(product.id),
    options.force,
    report,
    'code-readme',
    '代码仓 README',
  );
  await ensureGeneratedFile(
    path.join(codeRoot, '.gitignore'),
    'node_modules/\n.DS_Store\n',
    options.force,
    report,
    'code-gitignore',
    '代码仓 .gitignore',
  );
  await ensureGeneratedFile(
    path.join(codeRoot, 'AGENTS.md'),
    codeAgents(product.id),
    options.force,
    report,
    'code-agents',
    '代码仓 AGENTS',
  );

  try {
    await registerRepository(codeRoot, specRoot, product.id, product.id);
    phase(report, 'member', '自动登记代码仓', 'success', codeRoot);
    report.members.push({ id: product.id, path: codeRoot, status: 'registered' });
  } catch (error) {
    phase(report, 'member', '自动登记代码仓', 'failed', messageOf(error));
    report.warnings.push(`代码仓自动登记失败：${messageOf(error)}`);
    report.members.push({
      id: product.id,
      path: codeRoot,
      status: 'failed',
      reason: messageOf(error),
    });
  }

  try {
    const pointer = await writeWorkspacePointer(workspaceRoot, product.id, specRoot);
    report.pointer = {
      path: pointer.path,
      reused: false,
      anchor: pointer.anchor,
      product: pointer.product,
    };
    phase(report, 'pointer', '写入 workspace 指针', 'success', pointer.path);
  } catch (error) {
    phase(report, 'pointer', '写入 workspace 指针', 'failed', messageOf(error));
    report.warnings.push(`workspace 指针写入失败：${messageOf(error)}`);
  }

  await installBundledSkills(workspaceRoot, options, report);
  await updateRootAgents(workspaceRoot, specRoot, [codeRoot], report);
  report.next.push(
    `git -C ${quoteCommandArg(codeRoot)} add .`,
    `git -C ${quoteCommandArg(codeRoot)} commit -m "chore: initialize ${product.id}"`,
    `git -C ${quoteCommandArg(specRoot)} add .`,
    `git -C ${quoteCommandArg(specRoot)} commit -m "chore: initialize ${product.id}-spec"`,
    'openissue list',
  );
  return finalize(report);
}

export async function scanWorkspace(workspaceRoot: string): Promise<ScanResult> {
  const anchors: AnchorCandidate[] = [];
  const excluded: Array<{ path: string; store: string }> = [];
  const roots = [workspaceRoot];
  const entries = await readdir(workspaceRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'node_modules') {
      continue;
    }
    roots.push(path.join(workspaceRoot, entry.name));
  }

  for (const root of roots) {
    if (await productExists(root)) {
      try {
        const product = await readProduct(root);
        anchors.push({
          root,
          kind: 'openissue',
          product,
          reason: '已有 openissue/product.yaml',
          storeIds: await readAnchorStoreIds(root, product.id),
        });
      } catch {
        // The candidate is visible in the directory but cannot be used.
      }
      continue;
    }
    if (await hasCompleteOpenspecData(root)) {
      anchors.push({
        root,
        kind: 'openspec',
        product: undefined,
        reason: '包含完整 OpenSpec 规范数据',
        storeIds: [],
      });
      continue;
    }
    const store = await readStorePointer(root);
    if (store) excluded.push({ path: root, store });
  }

  return {
    anchors,
    excluded,
    directGitRepos: await scanDirectChildGitRepos(workspaceRoot),
    ordinary: await ordinaryWorkspaceEntries(workspaceRoot),
  };
}

export async function scanDirectChildGitRepos(workspaceRoot: string): Promise<string[]> {
  const entries = await readdir(workspaceRoot, { withFileTypes: true });
  const repos: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'node_modules') {
      continue;
    }
    const root = path.join(workspaceRoot, entry.name);
    if (await exists(path.join(root, '.git'))) repos.push(root);
  }
  return repos.sort((left, right) => left.localeCompare(right));
}

export async function buildMemberCandidates(
  workspaceRoot: string,
  anchorRoot: string,
  directGitRepos: string[],
  productId: string,
): Promise<MemberCandidate[]> {
  const anchorStoreIds = await readAnchorStoreIds(anchorRoot, productId);
  const candidates: MemberCandidate[] = [];
  for (const root of directGitRepos) {
    if (path.resolve(root) === path.resolve(anchorRoot)) continue;
    const id = path.basename(root);
    const pointerFile = path.join(root, MEMBER_FILE);
    if (await exists(pointerFile)) {
      try {
        const pointer = await readMemberPointer(root);
        const ids = pointer.products.map((item) => item.id);
        if (ids.length > 0 && ids.every((value) => value === productId)) {
          candidates.push({
            root,
            id,
            status: 'existing',
            preselected: true,
            reason: `已登记到 ${productId}`,
          });
        } else {
          candidates.push({
            root,
            id,
            status: 'conflict',
            preselected: false,
            reason: `已归属 ${ids.join('、')}`,
          });
        }
      } catch (error) {
        candidates.push({
          root,
          id,
          status: 'invalid',
          preselected: false,
          reason: `成员指针无法读取：${messageOf(error)}`,
        });
      }
      continue;
    }

    const store = await readStorePointer(root);
    if (store && anchorStoreIds.includes(store)) {
      candidates.push({
        root,
        id,
        status: 'candidate',
        preselected: true,
        reason: `store 指针匹配 ${store}`,
      });
    } else {
      candidates.push({
        root,
        id,
        status: 'candidate',
        preselected: false,
        reason: store ? `store 指针 ${store} 不匹配` : '直接子 Git 仓',
      });
    }
  }
  return candidates.sort((left, right) => left.root.localeCompare(right.root));
}

async function selectAnchor(
  workspaceRoot: string,
  candidates: AnchorCandidate[],
  options: InitOptions,
): Promise<AnchorCandidate> {
  if (options.anchorPath) {
    const root = path.resolve(workspaceRoot, options.anchorPath);
    const matched = candidates.find((candidate) => path.resolve(candidate.root) === root);
    if (matched) return matched;
    if (await productExists(root)) {
      return {
        root,
        kind: 'openissue',
        product: await readProduct(root),
        reason: '显式指定',
        storeIds: [],
      };
    }
    if (await hasCompleteOpenspecData(root)) {
      return {
        root,
        kind: 'openspec',
        product: undefined,
        reason: '显式指定',
        storeIds: [],
      };
    }
    throw new OpenIssueError(
      `指定的锚点不是 OpenIssue/OpenSpec 规范仓：${root}`,
      'NOT_ANCHOR',
    );
  }

  if (candidates.length === 1) return candidates[0]!;
  if (options.yes) {
    throw new OpenIssueError(
      `发现多个锚点候选：${candidates
        .map((candidate) => toPosix(path.relative(workspaceRoot, candidate.root)))
        .join('、')}。请用 --anchor <path> 明确选择；未选择前不会写入任何内容。`,
      'ANCHOR_SELECTION_REQUIRED',
    );
  }
  if (!options.interactive || !process.stdin.isTTY) {
    throw new OpenIssueError(
      `发现多个锚点候选：${candidates
        .map((candidate) => toPosix(path.relative(workspaceRoot, candidate.root)))
        .join('、')}。请用 --anchor <path> 明确选择。`,
      'ANCHOR_SELECTION_REQUIRED',
    );
  }
  return promptAnchor(workspaceRoot, candidates);
}

async function selectMembers(
  workspaceRoot: string,
  candidates: MemberCandidate[],
  options: InitOptions,
): Promise<MemberSelection[]> {
  if (options.skipMembers) {
    if (options.memberPaths.length > 0) {
      throw new OpenIssueError('--member 与 --no-members 不能同时使用', 'INVALID_INIT_OPTIONS');
    }
    phaseSkipMembers(workspaceRoot, candidates);
    return [];
  }

  if (options.memberPaths.length > 0) {
    const selected: MemberSelection[] = [];
    for (const input of options.memberPaths) {
      const root = path.isAbsolute(input) ? path.resolve(input) : path.resolve(workspaceRoot, input);
      const candidate = candidates.find(
        (item) => path.resolve(item.root) === path.resolve(root),
      );
      if (!candidate) {
        throw new OpenIssueError(
          `--member 不是直接子 Git 仓候选：${input}`,
          'MEMBER_NOT_CANDIDATE',
        );
      }
      if (candidate.status === 'conflict') {
        throw new OpenIssueError(
          `成员 ${toPosix(path.relative(workspaceRoot, candidate.root))} 已归属其他产品：${candidate.reason}`,
          'MEMBER_CONFLICT',
        );
      }
      selected.push({ candidate });
    }
    return selected;
  }

  if (options.yes) {
    return candidates
      .filter((candidate) => candidate.preselected && candidate.status !== 'conflict')
      .map((candidate) => ({ candidate }));
  }

  if (candidates.length === 0) return [];
  if (!options.interactive || !process.stdin.isTTY) {
    throw new OpenIssueError(
      `发现成员候选：${candidates
        .map((candidate) => toPosix(path.relative(workspaceRoot, candidate.root)))
        .join('、')}。请用 --member <path> 选择，或用 --no-members 跳过，或用 --yes 接受预选项。`,
      'MEMBER_CONFIRMATION_REQUIRED',
    );
  }
  return promptMembers(workspaceRoot, candidates);
}

async function registerMembers(
  anchorRoot: string,
  product: ProductManifest,
  selected: MemberSelection[],
  report: InitReport,
): Promise<void> {
  if (selected.length === 0) {
    phase(report, 'members', '登记成员仓库', 'skipped', '没有选中的成员');
    return;
  }
  let failed = 0;
  for (const { candidate } of selected) {
    try {
      await registerRepository(candidate.root, anchorRoot, product.id, candidate.id);
      report.members.push({
        id: candidate.id,
        path: candidate.root,
        status: 'registered',
      });
    } catch (error) {
      failed += 1;
      report.members.push({
        id: candidate.id,
        path: candidate.root,
        status: 'failed',
        reason: messageOf(error),
      });
      report.warnings.push(
        `成员 ${toPosix(path.basename(candidate.root))} 登记失败：${messageOf(error)}`,
      );
    }
  }
  if (failed === 0) {
    phase(report, 'members', '登记成员仓库', 'success', `已登记 ${selected.length} 个成员`);
  } else {
    phase(report, 'members', '登记成员仓库', 'failed', `${failed} 个成员登记失败`);
  }
}

async function ensureProduct(
  anchorRoot: string,
  identity: { id: string; name: string },
  report: InitReport,
): Promise<ProductManifest> {
  validateProductId(identity.id);
  if (await productExists(anchorRoot)) {
    const product = await readProduct(anchorRoot);
    if (product.id !== identity.id) {
      throw new OpenIssueError(
        `锚点产品标识是 ${product.id}，与请求的 ${identity.id} 不一致`,
        'PRODUCT_MISMATCH',
      );
    }
    phase(report, 'product', 'OpenIssue 产品', 'skipped', `复用 ${product.id}`);
    return product;
  }
  const product = await initProduct(anchorRoot, identity.id, identity.name.trim() || identity.id);
  phase(report, 'product', 'OpenIssue 产品', 'success', `已创建 ${product.id}`);
  return product;
}

async function registerProduct(
  product: ProductManifest,
  anchorRoot: string,
  report: InitReport,
): Promise<void> {
  try {
    await registerAnchor(product.id, anchorRoot, product.name);
    phase(report, 'registry', '本机锚点注册', 'success', anchorRoot);
  } catch (error) {
    phase(report, 'registry', '本机锚点注册', 'failed', messageOf(error));
    report.warnings.push(`锚点已创建，但本机注册失败：${messageOf(error)}`);
  }
}

async function shouldInitializeOpenspec(
  anchorRoot: string,
  options: InitOptions,
  mode: 'workspace' | 'single-repo',
): Promise<boolean> {
  if (await hasCompleteOpenspecData(anchorRoot)) return false;
  if (options.openspec === false) return false;
  if (options.openspec === true) return true;
  if (options.yes) return true;
  if (!options.interactive || !process.stdin.isTTY) {
    throw new OpenIssueError(
      `当前${mode === 'single-repo' ? ' Git 仓' : '锚点仓库'}尚未初始化 OpenSpec。请加 --openspec 初始化，或加 --no-openspec 跳过。`,
      'OPENSPEC_CONFIRMATION_REQUIRED',
    );
  }
  return confirm('OpenSpec 尚未初始化，是否现在补初始化？', options);
}

async function initializeOpenspec(
  anchorRoot: string,
  workspaceRoot: string,
  options: InitOptions,
  report: InitReport,
): Promise<boolean> {
  const tools = options.skills.length > 0 ? 'agents' : 'none';
  const result = runOpenspecInit(
    anchorRoot,
    tools,
    options.language,
    options.force === true,
  );
  if (result.status === 'success') {
    phase(report, 'openspec', 'OpenSpec 初始化', 'success', anchorRoot);
    if (
      options.skills.length > 0 &&
      path.resolve(anchorRoot) !== path.resolve(workspaceRoot)
    ) {
      const promotion = await promoteSkillsDirectory(anchorRoot, workspaceRoot, {
        force: options.force === true,
      });
      if (promotion.status === 'promoted' || promotion.status === 'unchanged') {
        phase(
          report,
          'openspec-skills',
          '提升 OpenSpec skills',
          'success',
          promotion.target,
        );
      } else if (promotion.status === 'missing') {
        phase(report, 'openspec-skills', '提升 OpenSpec skills', 'skipped', '未生成 .agents/skills');
      } else {
        phase(
          report,
          'openspec-skills',
          '提升 OpenSpec skills',
          'failed',
          promotion.message,
        );
        report.warnings.push(promotion.message ?? 'OpenSpec skills 提升冲突或失败。');
      }
    }
    return true;
  }

  if (result.status === 'unavailable') {
    phase(report, 'openspec', 'OpenSpec 初始化', 'failed', 'OpenSpec CLI 不可用');
    report.warnings.push(
      'OpenSpec CLI 不可用；OpenSpec 尚未初始化。安装后可在锚点运行 openspec init。',
    );
    return false;
  }

  const details = result.stderr.trim() || result.stdout.trim();
  phase(
    report,
    'openspec',
    'OpenSpec 初始化',
    'failed',
    details || 'openspec init 失败',
  );
  report.warnings.push(
    `OpenSpec 初始化失败；已创建内容保留。修复后可在锚点运行 openspec init。${details ? `\n${details}` : ''}`,
  );
  return false;
}

async function installBundledSkills(
  workspaceRoot: string,
  options: InitOptions,
  report: InitReport,
): Promise<void> {
  if (options.skills.length === 0) {
    phase(report, 'skills', '安装 OpenIssue skills', 'skipped', '--skills none');
    return;
  }
  try {
    const results = await installSkills(workspaceRoot, options.skills, {
      force: options.force === true,
    });
    phase(report, 'skills', '安装 OpenIssue skills', 'success', summarizeInstall(results));
  } catch (error) {
    phase(report, 'skills', '安装 OpenIssue skills', 'failed', messageOf(error));
    report.warnings.push(`OpenIssue skills 安装失败：${messageOf(error)}`);
  }
}

async function ensureSpecAgents(
  specRoot: string,
  product: ProductManifest,
  options: InitOptions,
  report: InitReport,
): Promise<void> {
  const file = path.join(specRoot, 'AGENTS.md');
  if (await exists(file)) {
    try {
      const content = await readFile(file, 'utf8');
      phase(report, 'spec-agents', 'spec 仓 AGENTS', 'skipped', `保留现有文件：${content.length} 字节`);
    } catch (error) {
      phase(report, 'spec-agents', 'spec 仓 AGENTS', 'failed', messageOf(error));
      report.warnings.push(`spec 仓 AGENTS.md 无法读取：${messageOf(error)}`);
    }
    return;
  }
  const openspecReady = await hasCompleteOpenspecData(specRoot);
  try {
    await writeTextAtomic(file, specAgents(product.id, openspecReady));
    phase(report, 'spec-agents', 'spec 仓 AGENTS', 'success', file);
  } catch (error) {
    phase(report, 'spec-agents', 'spec 仓 AGENTS', 'failed', messageOf(error));
    report.warnings.push(`spec 仓 AGENTS.md 写入失败：${messageOf(error)}`);
  }
}

async function ensureGeneratedFile(
  file: string,
  content: string,
  force: boolean | undefined,
  report: InitReport,
  phaseId: string,
  label: string,
): Promise<void> {
  try {
    const existing = await readOptional(file);
    if (existing === undefined) {
      await writeTextAtomic(file, content);
      phase(report, phaseId, label, 'success', file);
      return;
    }
    if (existing === content) {
      phase(report, phaseId, label, 'skipped', '内容未变化');
      return;
    }
    if (force) {
      await writeTextAtomic(file, content);
      phase(report, phaseId, label, 'success', '已按 --force 覆盖');
      return;
    }
    throw new OpenIssueError(
      `目标文件已存在且内容不同：${file}。确认覆盖时使用 --force。`,
      'INIT_FILE_CONFLICT',
    );
  } catch (error) {
    phase(report, phaseId, label, 'failed', messageOf(error));
    report.warnings.push(`${label} 写入失败：${messageOf(error)}`);
  }
}

async function updateRootAgents(
  workspaceRoot: string,
  anchorRoot: string,
  memberRoots: string[],
  report: InitReport,
): Promise<void> {
  const targets: Array<{ label: string; file: string }> = [];
  const anchorAgents = path.join(anchorRoot, 'AGENTS.md');
  if (await isFile(anchorAgents)) {
    targets.push({ label: 'spec/issue 仓', file: anchorAgents });
  }
  for (const memberRoot of memberRoots) {
    const file = path.join(memberRoot, 'AGENTS.md');
    if (await isFile(file)) {
      targets.push({ label: `代码仓 ${path.basename(memberRoot)}`, file });
    }
  }

  const lines =
    targets.length > 0
      ? targets.map(
          (target) =>
            `- ${target.label}：[AGENTS.md](${toPosix(path.relative(workspaceRoot, target.file))})`,
        )
      : ['- 尚无可用 AGENTS.md 入口。'];
  const section = `${AGENTS_START}\n## OpenIssue workspace\n\n${lines.join('\n')}\n${AGENTS_END}`;
  const file = path.join(workspaceRoot, 'AGENTS.md');
  try {
    const existing = await readOptional(file);
    if (existing === undefined) {
      await writeTextAtomic(file, `${section}\n`);
      phase(report, 'agents', 'workspace AGENTS 索引', 'success', file);
      return;
    }
    let replaced = false;
    const next = existing.replace(
      /<!-- OPENISSUE:START -->[\s\S]*?<!-- OPENISSUE:END -->/g,
      () => {
        if (replaced) return '';
        replaced = true;
        return section;
      },
    );
    const merged = replaced
      ? next
      : `${existing.trimEnd()}${existing.trimEnd() ? '\n\n' : ''}${section}\n`;
    if (merged === existing) {
      phase(report, 'agents', 'workspace AGENTS 索引', 'skipped', '内容未变化');
      return;
    }
    await writeTextAtomic(file, merged);
    phase(report, 'agents', 'workspace AGENTS 索引', 'success', file);
  } catch (error) {
    phase(report, 'agents', 'workspace AGENTS 索引', 'failed', messageOf(error));
    report.warnings.push(`workspace AGENTS 索引写入失败：${messageOf(error)}`);
  }
}

async function resolveMemberRoots(
  workspaceRoot: string,
  anchorRoot: string,
  product: ProductManifest,
): Promise<string[]> {
  const roots: string[] = [];
  for (const member of product.members) {
    const candidates: string[] = [];
    if (member.path) {
      candidates.push(
        path.isAbsolute(member.path) ? member.path : path.resolve(anchorRoot, member.path),
      );
    }
    candidates.push(path.join(workspaceRoot, member.id));
    for (const candidate of candidates) {
      if (await isFile(path.join(candidate, 'AGENTS.md'))) {
        roots.push(candidate);
        break;
      }
    }
  }
  return roots;
}

async function confirm(message: string, options: InitOptions): Promise<boolean> {
  if (options.yes) return true;
  if (!options.interactive || !process.stdin.isTTY) {
    throw new OpenIssueError(`需要确认：${message} 请追加 --yes。`, 'CONFIRMATION_REQUIRED');
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(`${message} [y/N] `);
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

async function promptAnchor(
  workspaceRoot: string,
  candidates: AnchorCandidate[],
): Promise<AnchorCandidate> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log('锚点候选：');
    candidates.forEach((candidate, index) => {
      console.log(
        `  ${index + 1}. ${toPosix(path.relative(workspaceRoot, candidate.root))}（${candidate.reason}）`,
      );
    });
    const answer = await rl.question('选择锚点编号：');
    const index = Number.parseInt(answer.trim(), 10) - 1;
    const selected = candidates[index];
    if (!selected) throw new OpenIssueError('无效的锚点编号', 'INVALID_SELECTION');
    return selected;
  } finally {
    rl.close();
  }
}

async function promptMembers(
  workspaceRoot: string,
  candidates: MemberCandidate[],
): Promise<MemberSelection[]> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log('成员候选：');
    candidates.forEach((candidate, index) => {
      console.log(
        `  ${index + 1}. ${toPosix(path.relative(workspaceRoot, candidate.root))}${candidate.preselected ? '（预选）' : ''} — ${candidate.reason ?? ''}`,
      );
    });
    const defaults = candidates
      .map((candidate, index) => (candidate.preselected ? index + 1 : 0))
      .filter((index) => index > 0)
      .join(',');
    const answer = await rl.question(`选择成员编号（逗号分隔，回车接受预选 ${defaults || '无'}）：`);
    const tokens =
      answer.trim() || defaults
        ? (answer.trim() || defaults).split(',').map((item) => item.trim()).filter(Boolean)
        : [];
    const selected: MemberSelection[] = [];
    for (const token of tokens) {
      const candidate = candidates[Number.parseInt(token, 10) - 1];
      if (!candidate) throw new OpenIssueError(`无效的成员编号：${token}`, 'INVALID_SELECTION');
      if (candidate.status === 'conflict') {
        throw new OpenIssueError(
          `成员 ${toPosix(path.relative(workspaceRoot, candidate.root))} 已归属其他产品：${candidate.reason}`,
          'MEMBER_CONFLICT',
        );
      }
      selected.push({ candidate });
    }
    return selected;
  } finally {
    rl.close();
  }
}

async function resolveProjectName(options: InitOptions): Promise<string> {
  if (options.name?.trim()) return options.name.trim();
  if (!options.interactive || !process.stdin.isTTY) {
    throw new OpenIssueError(
      '全新项目需要英文项目名。请追加 --name <name>。',
      'PROJECT_NAME_REQUIRED',
    );
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question('项目名（英文）：')).trim();
  } finally {
    rl.close();
  }
}

export function normalizeProjectName(input: string): string {
  const name = input.trim();
  if (!name || !/^[A-Za-z0-9][A-Za-z0-9 _-]*$/.test(name)) {
    throw new OpenIssueError(
      '项目名必须为英文，且只能包含字母、数字、空格、下划线与连字符。',
      'INVALID_PROJECT_NAME',
    );
  }
  const id = slugifyTitle(name);
  if (!id) {
    throw new OpenIssueError('项目名规范化后为空。', 'INVALID_PROJECT_NAME');
  }
  return id;
}

export function resolveExistingAnchorIdentity(
  root: string,
  options: InitOptions,
): { id: string; name: string } {
  const id = options.id?.trim() || slugifyTitle(path.basename(root)) || 'openissue-product';
  validateProductId(id);
  return { id, name: options.name?.trim() || id };
}

export function fallbackProductId(anchorRoot: string, requested: string | undefined): string {
  const id = requested?.trim() || slugifyTitle(path.basename(anchorRoot)) || 'openissue-product';
  validateProductId(id);
  return id;
}

function validateProductId(id: string): void {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
    throw new OpenIssueError(
      '产品标识只能包含小写字母、数字与连字符，且不能以连字符开头',
      'INVALID_PRODUCT_ID',
    );
  }
}

async function ensureGitRepo(root: string): Promise<{ ok: boolean; message?: string }> {
  if (await exists(path.join(root, '.git'))) return { ok: true };
  const result = spawnSync('git', ['init', '--quiet'], {
    cwd: root,
    encoding: 'utf8',
  });
  if (result.error) {
    return {
      ok: false,
      message: `Git 不可用：${(result.error as NodeJS.ErrnoException).message}`,
    };
  }
  if (result.status !== 0) {
    return {
      ok: false,
      message: (result.stderr || result.stdout || 'git init 失败').trim(),
    };
  }
  return { ok: true };
}

async function isKnownEmptyWorkspace(root: string): Promise<boolean> {
  return (await ordinaryWorkspaceEntries(root)).length === 0;
}

async function ordinaryWorkspaceEntries(root: string): Promise<string[]> {
  const allowed = new Set([
    WORKSPACE_FILE,
    '.git',
    '.gitignore',
    'AGENTS.md',
    '.agents',
    '.openissue-skills.json',
    '.home',
    '.DS_Store',
  ]);
  const entries = await readdir(root);
  return entries.filter((entry) => !allowed.has(entry)).sort((left, right) => left.localeCompare(right));
}

function emptyReport(
  workspaceRoot: string,
  mode: InitMode,
  language: Language,
): InitReport {
  return {
    mode,
    status: 'success',
    workspace_root: workspaceRoot,
    anchor_root: undefined,
    product: undefined,
    code_root: undefined,
    spec_root: undefined,
    pointer: undefined,
    candidates: undefined,
    members: [],
    phases: [],
    warnings: [],
    next: [],
    language,
    language_source: undefined,
    created: [],
    error: undefined,
  };
}

function phase(
  report: InitReport,
  id: string,
  label: string,
  status: InitPhaseStatus,
  message?: string,
): void {
  const entry: InitPhase = { id, label, status };
  if (message) entry.message = message;
  report.phases.push(entry);
}

function finalize(report: InitReport): InitReport {
  const failed = report.phases.some((item) => item.status === 'failed');
  report.status = failed ? 'partial' : 'success';
  report.created = [
    report.anchor_root,
    report.code_root,
    report.spec_root,
    report.pointer?.path,
  ].filter((item): item is string => typeof item === 'string' && item.length > 0);
  if (failed) {
    const first = report.phases.find((item) => item.status === 'failed');
    report.error = {
      code: 'INIT_PARTIAL',
      message:
        report.language === 'en'
          ? 'Initialization partially failed.'
          : first?.message ?? first?.label ?? 'Initialization partially failed.',
    };
  }
  return report;
}

function phaseSkipMembers(workspaceRoot: string, candidates: MemberCandidate[]): void {
  void workspaceRoot;
  void candidates;
}

function specReadme(id: string): string {
  return `# ${id}-spec\n\n产品 \`${id}\` 的 spec/issue 仓库。\n\n- 需求数据：\`openissue/\`\n- 规范与提案：\`openspec/\`（若已初始化）\n`;
}

function codeReadme(id: string): string {
  return `# ${id}\n\n产品 \`${id}\` 的代码仓库。需求与规范见 [\`${id}-spec\`](../${id}-spec/)。\n`;
}

function specAgents(id: string, openspecReady: boolean): string {
  return `# ${id}-spec\n\n本仓库承载产品 \`${id}\` 的 OpenIssue 需求数据与 OpenSpec 规范。\n\n- 需求数据：\`openissue/\`\n- 项目说明：\`README.md\`\n- OpenSpec：${openspecReady ? '`openspec/` 已初始化。' : '尚未初始化；运行 `openspec init` 后可用。'}\n`;
}

function codeAgents(id: string): string {
  return `# ${id}\n\n本仓库是产品 \`${id}\` 的成员代码仓库。\n\n- 仓库说明：\`README.md\`\n- 产品说明：\`../${id}-spec/AGENTS.md\`\n`;
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

async function isFile(file: string): Promise<boolean> {
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function quoteCommandArg(value: string): string {
  return /\s/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
}
