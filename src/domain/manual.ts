import { isRecord } from '../core/guards.js';
import type { Issue, Tier } from '../core/types.js';

export function applyManualTier(issue: Issue, value: Tier | 'auto'): void {
  const rawPriority = isRecord(issue.rawFrontmatter.priority)
    ? { ...issue.rawFrontmatter.priority }
    : {};
  if (value === 'auto') {
    delete issue.priority.manual_tier;
    delete issue.priority.manual_at;
    delete rawPriority.manual_tier;
    delete rawPriority.manual_at;
  } else {
    issue.priority.manual_tier = value;
    issue.priority.manual_at = new Date().toISOString();
    rawPriority.manual_tier = value;
    rawPriority.manual_at = issue.priority.manual_at;
  }
  issue.rawFrontmatter.priority = rawPriority;
}
