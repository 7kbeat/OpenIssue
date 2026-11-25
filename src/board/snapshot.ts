import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { contentHash } from '../core/hash.js';
import { toPosix } from '../core/paths.js';
import type {
  CloseReason,
  Issue,
  ProposalFact,
  SpecFact,
  Tier,
} from '../core/types.js';
import type { EvaluatedIssue as PriorityEvaluatedIssue } from '../domain/priority.js';
import type { BoardContext, BoardData } from './data.js';
import type {
  BoardFile,
  BoardSnapshot,
  CloseReason as UiCloseReason,
  ConflictRecord,
  DependencyNodeInfo,
  EvaluatedIssue,
  IssuePriorityMeta,
  IssueProposalLink,
  IssueRecord,
  OpenSpecChange,
  OpenSpecSpec,
  PriorityTier,
  ProductConfig,
  ProposalLinkStatus,
  StartContext,
  WorkspaceState,
} from './types.js';

const TIER_LABELS: Record<Tier, PriorityTier> = {
  high: '高',
  medium: '中',
  low: '低',
};

const CLOSE_LABELS: Record<CloseReason, UiCloseReason> = {
  completed: 'completed',
  wontdo: 'wont_do',
};

interface ChangeView {
  change: OpenSpecChange;
  linkedIssues: string[];
}

export async function buildBoardSnapshot(
  context: BoardContext,
  data: BoardData,
): Promise<BoardSnapshot> {
  const [factViews, issues, files] = await Promise.all([
    buildFacts(context, data),
    buildIssues(context, data),
    collectBoardFiles(context, data),
  ]);
  const issueById = new Map(data.issues.map((issue) => [issue.id, issue]));
  const evaluated = buildEvaluatedIssues(data, issueById, factViews.changes, issues);
  return {
    workspace: buildWorkspace(context, data),
    product: buildProduct(context, data),
    facts: factViews.facts,
    issues,
    evaluated,
    conflicts: buildConflicts(data),
    assistantAvailable: true,
    files,
    generatedAt: new Date().toISOString(),
  };
}

function buildWorkspace(context: BoardContext, data: BoardData): WorkspaceState {
  const mode = context.memberRoot ? 'member' : 'anchor';
  const repoRoot = context.memberRoot ?? context.anchorRoot;
  return {
    mode,
    currentRepoName: path.basename(repoRoot),
    currentRepoPath: toPosix(repoRoot),
    anchorRoot: toPosix(context.anchorRoot),
    productDir: toPosix(context.productDir),
    ...(context.memberRoot ? { memberRoot: toPosix(context.memberRoot) } : {}),
    selectedProductId: data.product.id,
    candidateProducts: [
      {
        id: data.product.id,
        name: data.product.name,
        anchor_repo: path.basename(context.anchorRoot),
      },
    ],
    openspecInitialized: data.facts.openspec_initialized,
    assistantAvailable: true,
    skillAvailable: data.skillAvailable,
  };
}

function buildProduct(context: BoardContext, data: BoardData): ProductConfig {
  return {
    id: data.product.id,
    name: data.product.name,
    anchor_repo: path.basename(context.anchorRoot),
    anchor_path: toPosix(context.anchorRoot),
    ...(data.product.focus
      ? {
          focus: {
            text: data.product.focus,
            updated_at: data.product.focus_updated_at ?? '',
          },
        }
      : {}),
    members: data.product.members.map((member) => ({
      id: member.id,
      ...(member.name !== undefined ? { name: member.name } : {}),
      ...(member.path !== undefined ? { path: member.path } : {}),
    })),
    raw: data.product.raw,
  };
}

async function buildFacts(
  context: BoardContext,
  data: BoardData,
): Promise<{ facts: BoardSnapshot['facts']; changes: Map<string, ChangeView> }> {
  const linkedIssues = new Map<string, string[]>();
  for (const issue of data.issues) {
    for (const proposal of issue.proposals) {
      const current = linkedIssues.get(proposal.id) ?? [];
      current.push(issue.id);
      linkedIssues.set(proposal.id, current);
    }
  }
  const [specs, changes] = await Promise.all([
    Promise.all(data.facts.specs.map((spec) => buildSpec(context.anchorRoot, spec))),
    Promise.all(
      data.facts.proposals.map((proposal) =>
        buildChange(context.anchorRoot, proposal, linkedIssues.get(proposal.id) ?? []),
      ),
    ),
  ]);
  const byId = new Map(changes.map((change) => [change.change.id, change]));
  return {
    facts: {
      specs,
      activeChanges: changes
        .filter((change) => change.change.status === 'active')
        .map((change) => change.change),
      archivedChanges: changes
        .filter((change) => change.change.status === 'archived')
        .map((change) => change.change),
      openspecInitialized: data.facts.openspec_initialized,
    },
    changes: byId,
  };
}

async function buildSpec(anchorRoot: string, spec: SpecFact): Promise<OpenSpecSpec> {
  const raw = await readFile(path.join(anchorRoot, spec.path), 'utf8').catch(() => '');
  const withoutHeading = raw.replace(/^#\s+.+\n*/m, '').trim();
  const summary = withoutHeading.split('\n').find((line) => line.trim())?.trim() ?? '';
  return {
    id: spec.id,
    name: spec.title,
    summary,
    path: spec.path,
  };
}

async function buildChange(
  anchorRoot: string,
  proposal: ProposalFact,
  linkedFromIssues: string[],
): Promise<ChangeView> {
  const dir = path.join(anchorRoot, proposal.path);
  const [proposalRaw, metadataRaw] = await Promise.all([
    readFile(path.join(dir, 'proposal.md'), 'utf8').catch(() => ''),
    readFile(path.join(dir, '.openspec.yaml'), 'utf8').catch(() => ''),
  ]);
  const metadata = parseYamlObject(metadataRaw);
  const linkedFromMetadata = Array.isArray(metadata['x-openissue-issues'])
    ? metadata['x-openissue-issues'].filter((value): value is string => typeof value === 'string')
    : [];
  const linkedIssues = [...new Set([...linkedFromMetadata, ...linkedFromIssues])];
  const archivedAt =
    typeof metadata.archived_at === 'string'
      ? metadata.archived_at
      : proposal.archived
        ? path.basename(proposal.path).slice(0, 10)
        : undefined;
  const description = proposalRaw.replace(/^#\s+.+\n*/m, '').trim();
  return {
    change: {
      id: proposal.id,
      title: proposal.title,
      description,
      status: proposal.archived ? 'archived' : 'active',
      ...(archivedAt ? { archived_at: archivedAt } : {}),
      path: proposal.path,
      tasks: { done: proposal.tasks_done, total: proposal.tasks_total },
      x_openissue_issues: linkedIssues,
      ...(metadataRaw ? { rawOpenspecYaml: metadataRaw } : {}),
    },
    linkedIssues,
  };
}

async function buildIssues(context: BoardContext, data: BoardData): Promise<IssueRecord[]> {
  return Promise.all(
    data.issues.map(async (issue) => {
      const rawMarkdown = await readFile(issue.filePath, 'utf8').catch(() => '');
      return {
        id: issue.id,
        title: issue.title,
        description: issue.description,
        product_id: issue.product,
        status: issue.status,
        ...(issue.close
          ? {
              close: {
                reason: CLOSE_LABELS[issue.close.reason],
                ...(issue.close.note ? { note: issue.close.note } : {}),
                closed_at: issue.close.closed_at,
              },
              close_reason: CLOSE_LABELS[issue.close.reason],
              ...(issue.close.note ? { close_note: issue.close.note } : {}),
              closed_at: issue.close.closed_at,
            }
          : {}),
        created_at: issue.created_at,
        updated_at: issue.updated_at,
        author: issue.author,
        source: issue.source,
        blocked_by: [...issue.blocked_by],
        proposals: issue.proposals.map(
          (proposal): IssueProposalLink => ({
            id: proposal.id,
            path: proposal.path,
            created_at: proposal.created_at,
            snapshot_hash: proposal.snapshot_hash,
          }),
        ),
        priority: buildPriority(issue),
        rawFrontmatter: issue.rawFrontmatter,
        filePath: toPosix(path.relative(context.anchorRoot, issue.filePath)),
        rawMarkdown,
      };
    }),
  );
}

function buildPriority(issue: Issue): IssuePriorityMeta {
  const priority = issue.priority;
  return {
    ...(priority.tier ? { tier: TIER_LABELS[priority.tier] } : {}),
    ...(priority.manual_tier ? { manual_tier: TIER_LABELS[priority.manual_tier] } : {}),
    ...(priority.order !== undefined ? { order: priority.order } : {}),
    ...(priority.reason ? { reason: priority.reason } : {}),
    ...(priority.basis ? { basis: [...priority.basis], evidence: [...priority.basis] } : {}),
    ...(priority.judged_at ? { judged_at: priority.judged_at } : {}),
    ...(priority.input_hash ? { input_hash: priority.input_hash } : {}),
    ...(priority.source ? { source: priority.source } : {}),
    ...(priority.manual_at ? { manual_at: priority.manual_at } : {}),
  };
}

function buildConflicts(data: BoardData): ConflictRecord[] {
  return data.conflicts.map((conflict) => ({
    id: path.basename(conflict.relativePath, '.md'),
    fileName: path.basename(conflict.relativePath),
    filePath: conflict.relativePath,
    relativePath: conflict.relativePath,
    error: conflict.error,
    rawContent: conflict.raw,
  }));
}

function buildEvaluatedIssues(
  data: BoardData,
  issueById: Map<string, Issue>,
  changeById: Map<string, ChangeView>,
  uiIssues: IssueRecord[],
): EvaluatedIssue[] {
  const uiById = new Map(uiIssues.map((issue) => [issue.id, issue]));
  const result: EvaluatedIssue[] = [];
  for (const group of ['high', 'medium', 'low', 'unassessed'] as const) {
    for (const item of data.evaluation.groups[group]) {
      result.push(
        buildEvaluatedIssue(item, data, issueById, uiById, changeById),
      );
    }
  }
  for (const issue of data.evaluation.closed) {
    const ui = uiById.get(issue.id);
    if (!ui) continue;
    result.push(buildClosedEvaluation(issue, ui, data, issueById, changeById));
  }
  return result;
}

function buildClosedEvaluation(
  issue: Issue,
  ui: IssueRecord,
  data: BoardData,
  issueById: Map<string, Issue>,
  changes: Map<string, ChangeView>,
): EvaluatedIssue {
  const reason = issue.close
    ? `已关闭 · ${issue.close.reason === 'completed' ? '已完成' : '不做'}${
        issue.close.note ? `（${issue.close.note}）` : ''
      }`
    : '已关闭';
  return {
    issue: ui,
    effectiveTier: null,
    reason,
    basis: [],
    precedenceStage: 'closed_excluded',
    isManual: false,
    manualOverriddenByRule: false,
    isStale: false,
    currentInputHash: '',
    sortRank: 0,
    dependencyDepth: 0,
    upstreamDeps: dependencyNodes(issue, issueById, data, 'upstream'),
    downstreamDeps: dependencyNodes(issue, issueById, data, 'downstream'),
    hasAbandonedUpstream: false,
    hasUnknownUpstream: false,
    isBlocked: false,
    invalidDependency: false,
    dependencyFloor: false,
    proposalStatuses: proposalStatuses(issue, data, changes),
    readyToConfirmComplete: false,
    hasBrokenProposalLink: hasBrokenLink(issue, data),
    hasSnapshotDiff: hasSnapshotDiff(issue, data),
  };
}

function buildEvaluatedIssue(
  item: PriorityEvaluatedIssue,
  data: BoardData,
  issueById: Map<string, Issue>,
  uiById: Map<string, IssueRecord>,
  changes: Map<string, ChangeView>,
): EvaluatedIssue {
  const issue = item.issue;
  const ui = uiById.get(issue.id);
  if (!ui) throw new Error(`missing issue view for ${issue.id}`);
  const upstream = dependencyNodes(issue, issueById, data, 'upstream');
  const downstream = dependencyNodes(issue, issueById, data, 'downstream');
  const hasAbandonedUpstream = upstream.some(
    (node) => node.status === 'closed' && node.close_reason === 'wont_do',
  );
  const hasUnknownUpstream = upstream.some((node) => node.status === 'unknown');
  const timestamp = issue.priority.judged_at;
  return {
    issue: ui,
    effectiveTier: TIER_LABELS[item.tier as Tier] ?? '待评估',
    reason: item.reason,
    basis: [...item.basis],
    precedenceStage: precedenceStage(item),
    isManual: item.manual,
    manualOverriddenByRule: item.manual && (item.dependency_floor || item.invalid_dependency),
    isStale: item.stale,
    currentInputHash: item.input_hash ?? '',
    sortRank: item.order + 1,
    dependencyDepth: dependencyDepth(issue, issueById),
    upstreamDeps: upstream,
    downstreamDeps: downstream,
    hasAbandonedUpstream,
    hasUnknownUpstream,
    isBlocked: item.blocked,
    ...(item.blocked_reason ? { blockedReason: item.blocked_reason } : {}),
    invalidDependency: item.invalid_dependency,
    ...(item.invalid_reason ? { invalidReason: item.invalid_reason } : {}),
    dependencyFloor: item.dependency_floor,
    proposalStatuses: proposalStatuses(issue, data, changes),
    readyToConfirmComplete: data.handoffs.get(issue.id)?.archived_pending ?? false,
    hasBrokenProposalLink: data.handoffs.get(issue.id)?.link_invalid ?? false,
    hasSnapshotDiff: data.handoffs.get(issue.id)?.updated_since_proposal ?? false,
    ...(timestamp ? { judgedAt: timestamp } : {}),
    ...(data.startContexts.has(issue.id)
      ? { startContext: data.startContexts.get(issue.id)! as StartContext }
      : {}),
  } as EvaluatedIssue;
}

function precedenceStage(item: {
  manual: boolean;
  invalid_dependency: boolean;
  invalid_reason?: string;
  dependency_floor: boolean;
  tier: string;
}): EvaluatedIssue['precedenceStage'] {
  if (item.invalid_dependency) {
    return item.invalid_reason?.includes('不明') ? 'dependency_unknown' : 'dependency_abandoned';
  }
  if (item.dependency_floor) return 'dependency_floor';
  if (item.manual) return 'manual_override';
  if (item.tier === 'high' || item.tier === 'medium' || item.tier === 'low') {
    return 'assistant_judgment';
  }
  return 'pending_evaluation';
}

function dependencyNodes(
  issue: Issue,
  issueById: Map<string, Issue>,
  data: BoardData,
  direction: 'upstream' | 'downstream',
): DependencyNodeInfo[] {
  const ids =
    direction === 'upstream'
      ? issue.blocked_by
      : data.issues
          .filter((candidate) => candidate.blocked_by.includes(issue.id))
          .map((candidate) => candidate.id);
  return ids.map((id) => {
    const related = issueById.get(id);
    if (!related) return { id, title: id, status: 'unknown' };
    const evaluated = data.evaluation.byId.get(id);
    return {
      id: related.id,
      title: related.title,
      status: related.status,
      ...(related.close ? { close_reason: CLOSE_LABELS[related.close.reason] } : {}),
      ...(evaluated ? { effectiveTier: TIER_LABELS[evaluated.tier as Tier] ?? '待评估' } : {}),
    };
  });
}

function proposalStatuses(
  issue: Issue,
  data: BoardData,
  changes: Map<string, ChangeView>,
): ProposalLinkStatus[] {
  const handoff = data.handoffs.get(issue.id);
  const handoffById = new Map(handoff?.proposals.map((proposal) => [proposal.id, proposal]) ?? []);
  return issue.proposals.map((proposal) => {
    const state = handoffById.get(proposal.id);
    const change = changes.get(proposal.id)?.change;
    const resolvedState =
      state?.state ??
      (change ? (change.status === 'archived' ? 'archived' : 'active') : 'missing');
    const currentHash = contentHash(issue.title, issue.description);
    return {
      id: proposal.id,
      path: proposal.path,
      created_at: proposal.created_at,
      snapshot_hash: proposal.snapshot_hash,
      state: resolvedState,
      ...(change ? { tasks: change.tasks } : {}),
      ...(change?.archived_at ? { archived_at: change.archived_at } : {}),
      hasSnapshotDiff:
        state?.updated_since_proposal ??
        (proposal.snapshot_hash !== undefined && proposal.snapshot_hash !== currentHash),
      ...(state?.interview?.status === 'incomplete' ? { interviewIncomplete: true } : {}),
      ...(state?.interview?.status === 'completed' ? { interviewCompleted: true } : {}),
      ...(state?.interview_unknown ? { interviewUnknown: true } : {}),
    };
  });
}

function hasBrokenLink(issue: Issue, data: BoardData): boolean {
  const handoff = data.handoffs.get(issue.id);
  if (handoff) return handoff.link_invalid;
  return issue.proposals.some((proposal) => !data.facts.proposals.some((fact) => fact.id === proposal.id));
}

function hasSnapshotDiff(issue: Issue, data: BoardData): boolean {
  const handoff = data.handoffs.get(issue.id);
  if (handoff) return handoff.updated_since_proposal;
  const current = contentHash(issue.title, issue.description);
  return issue.proposals.some(
    (proposal) => proposal.snapshot_hash !== undefined && proposal.snapshot_hash !== current,
  );
}

function dependencyDepth(issue: Issue, issueById: Map<string, Issue>): number {
  const visit = (id: string, seen: Set<string>): number => {
    if (seen.has(id)) return 0;
    const current = issueById.get(id);
    if (!current || current.status !== 'open') return 0;
    let depth = 0;
    for (const blockerId of current.blocked_by) {
      const blocker = issueById.get(blockerId);
      if (!blocker || blocker.status !== 'open') continue;
      depth = Math.max(depth, 1 + visit(blockerId, new Set([...seen, id])));
    }
    return depth;
  };
  return visit(issue.id, new Set());
}

function parseYamlObject(raw: string): Record<string, unknown> {
  if (!raw.trim()) return {};
  try {
    const parsed: unknown = YAML.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

async function collectBoardFiles(
  context: BoardContext,
  data: BoardData,
): Promise<BoardFile[]> {
  const files = new Map<string, BoardFile>();
  const add = async (filePath: string, displayPath?: string): Promise<void> => {
    const content = await readFile(filePath, 'utf8').catch(() => undefined);
    if (content === undefined) return;
    const ext = path.extname(filePath).toLowerCase();
    if (ext !== '.md' && ext !== '.yaml' && ext !== '.yml') return;
    const key = displayPath ?? toPosix(path.relative(context.anchorRoot, filePath));
    files.set(key, {
      path: key,
      content,
      kind: ext === '.md' ? 'markdown' : 'yaml',
    });
  };

  await add(path.join(context.productDir, 'product.yaml'), 'openissue/product.yaml');
  for (const issue of data.issues) {
    await add(issue.filePath, `openissue/issues/${issue.id}.md`);
  }
  for (const conflict of data.conflicts) {
    if (conflict.filePath) {
      await add(conflict.filePath, conflict.relativePath);
    }
  }
  await collectTree(path.join(context.anchorRoot, 'openspec'), context.anchorRoot, add);
  if (context.memberRoot) {
    const memberPointer = path.join(context.memberRoot, 'openissue-project.yaml');
    await add(memberPointer, 'member/openissue-project.yaml');
  }
  return [...files.values()].sort((a, b) => a.path.localeCompare(b.path));
}

async function collectTree(
  dir: string,
  base: string,
  add: (filePath: string, displayPath?: string) => Promise<void>,
): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectTree(full, base, add);
      continue;
    }
    if (!entry.isFile()) continue;
    await add(full, toPosix(path.relative(base, full)));
  }
}
