import type { Issue, IssueConflict, ProductManifest, ProjectFacts } from '../core/types.js';
import type { EvaluatedIssue, PriorityEvaluation } from '../domain/priority.js';
import { evaluatePriority } from '../domain/priority.js';
import type { HandoffState, StartContext } from '../services/handoff.js';
import { buildStartContext, emptyHandoffState, readHandoffState } from '../services/handoff.js';
import { hasCurrentSkill } from '../skills/install.js';
import { readProjectFacts } from '../storage/facts.js';
import { loadIssues } from '../storage/issue.js';
import { readProduct } from '../storage/product.js';

export interface BoardContext {
  anchorRoot: string;
  productDir: string;
  product: ProductManifest;
  memberRoot?: string;
}

export interface BoardData {
  product: ProductManifest;
  facts: ProjectFacts;
  evaluation: PriorityEvaluation;
  issues: Issue[];
  conflicts: IssueConflict[];
  handoffs: Map<string, HandoffState>;
  startContexts: Map<string, StartContext>;
  blocking: Map<string, string[]>;
  waiting: Map<string, string[]>;
  skillAvailable: boolean;
}

export async function loadBoardData(context: BoardContext): Promise<BoardData> {
  const product = await readProduct(context.anchorRoot);
  const collection = await loadIssues(context.productDir, product.id);
  const facts = await readProjectFacts(context.anchorRoot);
  const contextForPriority = { focus: product.focus, facts };
  const evaluation = evaluatePriority(collection.issues, contextForPriority);
  const handoffs = new Map<string, HandoffState>();
  for (const issue of collection.issues) {
    if (issue.proposals.length === 0) continue;
    try {
      handoffs.set(issue.id, await readHandoffState(context.anchorRoot, issue));
    } catch {
      // A malformed link must not hide the rest of the board.
    }
  }
  const skillAvailable = await hasCurrentSkill(context.anchorRoot, 'openissue-grill-me');
  const startContexts = new Map<string, StartContext>();
  for (const issue of collection.issues) {
    if (issue.status !== 'open') continue;
    startContexts.set(
      issue.id,
      buildStartContext({
        issue,
        focus: product.focus,
        handoff: handoffs.get(issue.id) ?? emptyHandoffState(),
        skillAvailable,
      }),
    );
  }
  const blocking = new Map<string, string[]>();
  const waiting = new Map<string, string[]>();
  for (const issue of collection.issues) {
    blocking.set(
      issue.id,
      collection.issues
        .filter(
          (candidate) =>
            candidate.status === 'open' && candidate.blocked_by.includes(issue.id),
        )
        .map((candidate) => candidate.id),
    );
    waiting.set(
      issue.id,
      issue.blocked_by
        .map((id) => collection.issues.find((candidate) => candidate.id === id))
        .filter((candidate): candidate is Issue => Boolean(candidate) && candidate!.status === 'open')
        .map((candidate) => candidate.id),
    );
  }
  return {
    product,
    facts,
    evaluation,
    issues: collection.issues,
    conflicts: collection.conflicts,
    handoffs,
    startContexts,
    blocking,
    waiting,
    skillAvailable,
  };
}

export function boardItem(data: BoardData, item: EvaluatedIssue): BoardItem {
  return {
    evaluated: item,
    ...(data.handoffs.has(item.issue.id) ? { handoff: data.handoffs.get(item.issue.id)! } : {}),
    ...(data.startContexts.has(item.issue.id) ? { start: data.startContexts.get(item.issue.id)! } : {}),
    blocking: data.blocking.get(item.issue.id) ?? [],
    waiting: data.waiting.get(item.issue.id) ?? [],
  };
}

export interface BoardItem {
  evaluated: EvaluatedIssue;
  handoff?: HandoffState;
  start?: StartContext;
  blocking: string[];
  waiting: string[];
}
