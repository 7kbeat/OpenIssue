import { sha256, stableJson } from '../core/hash.js';
import type { EffectiveTier, Issue, ProjectFacts, Tier } from '../core/types.js';

export const TIERS: Tier[] = ['high', 'medium', 'low'];
export const GROUPS: Array<Tier | 'unassessed'> = ['high', 'medium', 'low', 'unassessed'];

const RANK: Record<EffectiveTier, number> = {
  high: 3,
  medium: 2,
  low: 1,
  unassessed: 0,
};

export interface PriorityContext {
  focus: string;
  facts: ProjectFacts;
}

export interface EvaluatedIssue {
  issue: Issue;
  tier: EffectiveTier;
  reason: string;
  basis: string[];
  manual: boolean;
  stale: boolean;
  dependency_floor: boolean;
  invalid_dependency: boolean;
  invalid_reason?: string;
  blocked: boolean;
  blocked_reason?: string;
  order: number;
  input_hash?: string;
  judged_at?: string;
}

export interface PriorityEvaluation {
  byId: Map<string, EvaluatedIssue>;
  groups: Record<'high' | 'medium' | 'low' | 'unassessed', EvaluatedIssue[]>;
  closed: Issue[];
}

export function tierLabel(tier: EffectiveTier): string {
  if (tier === 'high') return '高';
  if (tier === 'medium') return '中';
  if (tier === 'low') return '低';
  return '待评估';
}

export function evaluatePriority(
  issues: Issue[],
  context?: PriorityContext,
): PriorityEvaluation {
  const byId = new Map(issues.map((issue) => [issue.id, issue]));
  const evaluated = new Map<string, EvaluatedIssue>();
  const closed: Issue[] = [];

  for (const issue of issues) {
    if (issue.status === 'closed') {
      closed.push(issue);
      continue;
    }
    const state = evaluateBase(issue, byId, context);
    evaluated.set(issue.id, state);
  }

  propagateFloor(evaluated);
  appendDependencyReasons(evaluated, issues);

  const groups: PriorityEvaluation['groups'] = {
    high: [],
    medium: [],
    low: [],
    unassessed: [],
  };
  for (const state of evaluated.values()) groups[state.tier].push(state);
  for (const key of GROUPS) {
    groups[key].sort((a, b) => compareForOrder(a, b, evaluated));
    groups[key].forEach((item, index) => {
      item.order = index;
    });
  }
  closed.sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  return { byId: evaluated, groups, closed };
}

function evaluateBase(
  issue: Issue,
  byId: Map<string, Issue>,
  context?: PriorityContext,
): EvaluatedIssue {
  const missing = issue.blocked_by.filter((id) => !byId.has(id));
  const wontdo = issue.blocked_by
    .map((id) => byId.get(id))
    .filter((item): item is Issue => Boolean(item) && item!.status === 'closed' && item!.close?.reason === 'wontdo');
  const waiting = issue.blocked_by
    .map((id) => byId.get(id))
    .filter((item): item is Issue => Boolean(item) && item!.status === 'open');
  const invalid = missing.length > 0 || wontdo.length > 0;
  const invalidReason = invalid
    ? missing.length > 0 && wontdo.length === 0
      ? '依赖状态不明，需要重新评估'
      : '前置需求已放弃，需要重新评估'
    : undefined;
  const manualTier = issue.priority.manual_tier;
  const cachedTier = issue.priority.tier;
  const manual = Boolean(manualTier);
  const hasCache = Boolean(cachedTier && issue.priority.reason);
  const inputHash = context ? computeIssueInputHash(issue, context) : undefined;
  const stale = Boolean(
    hasCache && inputHash !== undefined && issue.priority.input_hash !== inputHash,
  );

  let tier: EffectiveTier = 'unassessed';
  let reason = '依据不足，待评估';
  let basis: string[] = [];
  if (manualTier) {
    tier = manualTier;
    reason = `手动设定为${tierLabel(manualTier)}`;
    basis = ['manual'];
  } else if (hasCache && cachedTier) {
    tier = cachedTier;
    reason = issue.priority.reason!;
    basis = issue.priority.basis ?? [];
  }

  if (invalid) {
    tier = 'unassessed';
    reason = invalidReason!;
    basis = [
      ...wontdo.map((item) => `dependency:${item.id}`),
      ...missing.map((id) => `dependency:${id}`),
    ];
  }

  const blocked = waiting.length > 0 || invalid;
  const blockedReason = invalid
    ? invalidReason
    : waiting.length > 0
      ? `等待 ${waiting.map((item) => item.id).join('、')}`
      : undefined;

  return {
    issue,
    tier,
    reason,
    basis,
    manual,
    stale,
    dependency_floor: false,
    invalid_dependency: invalid,
    ...(invalidReason ? { invalid_reason: invalidReason } : {}),
    blocked,
    ...(blockedReason ? { blocked_reason: blockedReason } : {}),
    order: 0,
    ...(inputHash ? { input_hash: inputHash } : {}),
    ...(issue.priority.judged_at ? { judged_at: issue.priority.judged_at } : {}),
  };
}

function propagateFloor(evaluated: Map<string, EvaluatedIssue>): void {
  const states = [...evaluated.values()].filter((state) => !state.invalid_dependency);
  const limit = Math.max(1, states.length * states.length);
  for (let iteration = 0; iteration < limit; iteration += 1) {
    let changed = false;
    for (const blocked of states) {
      if (blocked.tier === 'unassessed') continue;
      for (const blockerId of blocked.issue.blocked_by) {
        const blocker = evaluated.get(blockerId);
        if (!blocker || blocker.invalid_dependency) continue;
        if (RANK[blocked.tier] <= RANK[blocker.tier]) continue;
        blocker.tier = blocked.tier;
        blocker.dependency_floor = true;
        blocker.basis = [...new Set([...blocker.basis, `dependency:${blocked.issue.id}`])];
        blocker.reason = floorReason(blocker, blocked);
        changed = true;
      }
    }
    if (!changed) return;
  }
}

function floorReason(blocker: EvaluatedIssue, blocked: EvaluatedIssue): string {
  const suffix = blocker.manual ? `（手动值${tierLabel(blocker.issue.priority.manual_tier!)}已保留）` : '';
  return `依赖下限：阻塞了${tierLabel(blocked.tier)}档需求 ${blocked.issue.id}${suffix}`;
}

function appendDependencyReasons(
  evaluated: Map<string, EvaluatedIssue>,
  issues: Issue[],
): void {
  for (const state of evaluated.values()) {
    if (state.invalid_dependency) continue;
    const waiting = state.issue.blocked_by
      .map((id) => evaluated.get(id))
      .filter((item): item is EvaluatedIssue => Boolean(item) && item!.issue.status === 'open')
      .map((item) => item.issue.id);
    if (waiting.length > 0 && !state.reason.includes('等待')) {
      state.reason = `${state.reason}；等待 ${waiting.join('、')}`;
    }
    const blocks = issues
      .filter((candidate) => candidate.status === 'open' && candidate.blocked_by.includes(state.issue.id))
      .map((candidate) => candidate.id);
    if (blocks.length > 0 && !state.reason.includes('阻塞')) {
      state.reason = `${state.reason}；阻塞 ${blocks.join('、')}`;
    }
  }
}

export function computeIssueInputHash(issue: Issue, context: PriorityContext): string {
  const proposals = issue.proposals
    .map((link) => {
      const fact = context.facts.proposals.find((item) => item.id === link.id);
      return {
        id: link.id,
        state: fact ? (fact.archived ? 'archived' : 'active') : 'missing',
        tasks_total: fact?.tasks_total ?? 0,
        tasks_done: fact?.tasks_done ?? 0,
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
  const facts = {
    specs: [...context.facts.specs]
      .map((item) => item.id)
      .sort((a, b) => a.localeCompare(b)),
    proposals: [...context.facts.proposals]
      .map((item) => ({
        id: item.id,
        archived: item.archived,
        tasks_total: item.tasks_total,
        tasks_done: item.tasks_done,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  };
  return sha256(
    stableJson({
      focus: context.focus,
      issue: {
        id: issue.id,
        title: issue.title,
        description: issue.description,
        blocked_by: [...issue.blocked_by].sort(),
      },
      proposals,
      facts,
    }),
  );
}

function compareForOrder(
  a: EvaluatedIssue,
  b: EvaluatedIssue,
  evaluated: Map<string, EvaluatedIssue>,
): number {
  const aOrder = a.issue.priority.order;
  const bOrder = b.issue.priority.order;
  if (typeof aOrder === 'number' && typeof bOrder === 'number' && aOrder !== bOrder) {
    return aOrder - bOrder;
  }
  const depthA = dependencyDepth(a.issue, evaluated, new Set());
  const depthB = dependencyDepth(b.issue, evaluated, new Set());
  if (depthA !== depthB) return depthA - depthB;
  const created = a.issue.created_at.localeCompare(b.issue.created_at);
  if (created !== 0) return created;
  return a.issue.id.localeCompare(b.issue.id);
}

function dependencyDepth(
  issue: Issue,
  evaluated: Map<string, EvaluatedIssue>,
  seen: Set<string>,
): number {
  if (seen.has(issue.id)) return 0;
  seen.add(issue.id);
  let depth = 0;
  for (const blockerId of issue.blocked_by) {
    const blocker = evaluated.get(blockerId)?.issue;
    if (!blocker) continue;
    depth = Math.max(depth, 1 + dependencyDepth(blocker, evaluated, seen));
  }
  return depth;
}
