import type { EvaluatedIssue, SearchFilterState } from '../../types.js';

export const DEFAULT_SEARCH_FILTER: SearchFilterState = {
  query: '',
  status: 'open',
  tier: 'all',
  proposal: 'all',
  blocked: 'all',
};

export function hasActiveFilters(filter: SearchFilterState): boolean {
  return (
    filter.query.trim().length > 0 ||
    filter.status !== 'open' ||
    filter.tier !== 'all' ||
    filter.proposal !== 'all' ||
    filter.blocked !== 'all'
  );
}

/**
 * Filters evaluated issues by text query (case-insensitive across title + description)
 * and composite filters (status, tier, proposal link, blocked status).
 * Conflict records are kept separate and never filtered out or hidden.
 */
export function filterEvaluatedIssues(
  evaluated: EvaluatedIssue[],
  filter: SearchFilterState
): EvaluatedIssue[] {
  const q = filter.query.trim().toLowerCase();

  return evaluated.filter((ev) => {
    const { issue } = ev;

    // Status filter
    if (filter.status === 'open' && issue.status !== 'open') {
      return false;
    }
    if (filter.status === 'closed_only' && issue.status !== 'closed') {
      return false;
    }

    // Tier filter. Closed issues are not evaluated, so fall back to the cached
    // or manual tier to keep their filters consistent with the CLI.
    if (filter.tier !== 'all') {
      const tier =
        issue.status === 'closed'
          ? issue.priority.manual_tier ?? issue.priority.tier ?? '待评估'
          : ev.effectiveTier;
      if (tier !== filter.tier) {
        return false;
      }
    }

    // Proposal filter
    if (filter.proposal === 'linked' && issue.proposals.length === 0) {
      return false;
    }
    if (filter.proposal === 'unlinked' && issue.proposals.length > 0) {
      return false;
    }

    // Blocked filter (includes open upstream, abandoned upstream, unknown upstream)
    const blocked =
      ev.isBlocked ||
      ev.upstreamDeps.some(
        (upstream) =>
          upstream.status === 'open' ||
          upstream.status === 'unknown' ||
          upstream.close_reason === 'wont_do',
      );
    if (filter.blocked === 'blocked' && !blocked) {
      return false;
    }
    if (filter.blocked === 'unblocked' && blocked) {
      return false;
    }

    // Case-insensitive search across title & description
    if (q.length > 0) {
      const titleMatch = issue.title.toLowerCase().includes(q);
      const descMatch = issue.description.toLowerCase().includes(q);
      const idMatch = issue.id.toLowerCase().includes(q);
      if (!titleMatch && !descMatch && !idMatch) {
        return false;
      }
    }

    return true;
  });
}
