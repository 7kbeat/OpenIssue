import type { EffectiveTier, Issue } from '../core/types.js';
import type { EvaluatedIssue, PriorityEvaluation } from './priority.js';

export type StatusFilter = 'open' | 'closed' | 'all';
export type LinkedFilter = 'yes' | 'no';
export type BlockedFilter = 'yes' | 'no';

export interface BoardFilters {
  q: string;
  status: StatusFilter;
  tier?: EffectiveTier;
  linked?: LinkedFilter;
  blocked?: BlockedFilter;
}

export interface FilteredEvaluation {
  groups: PriorityEvaluation['groups'];
  closed: Issue[];
}

export function parseFilters(params: URLSearchParams): BoardFilters {
  const statusValue = params.get('status');
  const status: StatusFilter =
    statusValue === 'closed' || statusValue === 'all' ? statusValue : 'open';
  const tierValue = params.get('tier');
  const tier =
    tierValue === 'high' ||
    tierValue === 'medium' ||
    tierValue === 'low' ||
    tierValue === 'unassessed'
      ? tierValue
      : undefined;
  const linkedValue = params.get('linked');
  const linked = linkedValue === 'yes' || linkedValue === 'no' ? linkedValue : undefined;
  const blockedValue = params.get('blocked');
  const blocked =
    blockedValue === 'yes' || blockedValue === 'no' ? blockedValue : undefined;
  return {
    q: params.get('q')?.trim() ?? '',
    status,
    ...(tier ? { tier } : {}),
    ...(linked ? { linked } : {}),
    ...(blocked ? { blocked } : {}),
  };
}

export function filterEvaluation(
  evaluation: PriorityEvaluation,
  filters: BoardFilters,
  allIssues: Issue[],
): FilteredEvaluation {
  const groups: FilteredEvaluation['groups'] = {
    high: [],
    medium: [],
    low: [],
    unassessed: [],
  };
  const byId = new Map(allIssues.map((issue) => [issue.id, issue]));
  if (filters.status !== 'closed') {
    for (const key of ['high', 'medium', 'low', 'unassessed'] as const) {
      groups[key] = evaluation.groups[key].filter((item) => matches(item, filters));
    }
  }
  const closed =
    filters.status === 'open'
      ? []
      : evaluation.closed.filter((issue) => matchesClosed(issue, filters, byId));
  return { groups, closed };
}

export function hasFilters(filters: BoardFilters): boolean {
  return Boolean(
    filters.q ||
      filters.status !== 'open' ||
      filters.tier ||
      filters.linked ||
      filters.blocked,
  );
}

export function matchesQuery(issue: Issue, query: string): boolean {
  if (!query) return true;
  const needle = query.toLocaleLowerCase();
  return (
    issue.title.toLocaleLowerCase().includes(needle) ||
    issue.description.toLocaleLowerCase().includes(needle)
  );
}

function matches(item: EvaluatedIssue, filters: BoardFilters): boolean {
  if (!matchesQuery(item.issue, filters.q)) return false;
  if (filters.tier && item.tier !== filters.tier) return false;
  if (filters.linked) {
    const linked = item.issue.proposals.length > 0;
    if (filters.linked === 'yes' && !linked) return false;
    if (filters.linked === 'no' && linked) return false;
  }
  if (filters.blocked) {
    if (filters.blocked === 'yes' && !item.blocked) return false;
    if (filters.blocked === 'no' && item.blocked) return false;
  }
  return true;
}

function matchesClosed(
  issue: Issue,
  filters: BoardFilters,
  byId: Map<string, Issue>,
): boolean {
  if (!matchesQuery(issue, filters.q)) return false;
  if (filters.tier) {
    const tier = issue.priority.manual_tier ?? issue.priority.tier ?? 'unassessed';
    if (tier !== filters.tier) return false;
  }
  if (filters.linked) {
    const linked = issue.proposals.length > 0;
    if (filters.linked === 'yes' && !linked) return false;
    if (filters.linked === 'no' && linked) return false;
  }
  if (filters.blocked) {
    const blocked = computeBlocked(issue, byId);
    if (filters.blocked === 'yes' && !blocked) return false;
    if (filters.blocked === 'no' && blocked) return false;
  }
  return true;
}

function computeBlocked(issue: Issue, byId: Map<string, Issue>): boolean {
  if (issue.blocked_by.length === 0) return false;
  return issue.blocked_by.some((id) => {
    const blocker = byId.get(id);
    if (!blocker) return true;
    if (blocker.status === 'open') return true;
    return blocker.close?.reason === 'wontdo';
  });
}
