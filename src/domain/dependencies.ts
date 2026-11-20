import { OpenIssueError } from '../core/errors.js';
import type { Issue } from '../core/types.js';

export function wouldCreateCycle(
  issues: Issue[],
  blockerId: string,
  blockedId: string,
): boolean {
  if (blockerId === blockedId) return true;
  const byId = new Map(issues.map((issue) => [issue.id, issue]));
  const stack = [blockerId];
  const seen = new Set<string>();
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === blockedId) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    const issue = byId.get(current);
    if (!issue) continue;
    for (const next of issue.blocked_by) stack.push(next);
  }
  return false;
}

export function assertCanDepend(
  issues: Issue[],
  blockerId: string,
  blockedId: string,
): void {
  if (blockerId === blockedId) {
    throw new OpenIssueError('一条需求不能阻塞自己', 'SELF_DEPENDENCY');
  }
  if (wouldCreateCycle(issues, blockerId, blockedId)) {
    throw new OpenIssueError('不能建立依赖：会形成循环', 'DEPENDENCY_CYCLE');
  }
}

export function blockingIssues(issue: Issue, issues: Issue[]): Issue[] {
  return issues.filter(
    (candidate) => candidate.status === 'open' && candidate.blocked_by.includes(issue.id),
  );
}
