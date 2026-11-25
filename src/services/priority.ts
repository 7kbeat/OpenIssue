import { errorMessage } from '../core/errors.js';
import type { PriorityContext, PriorityEvaluation } from '../domain/priority.js';
import { validateAssistantResponse } from '../domain/assistant.js';
import { mutateIssue } from '../storage/issue.js';

export interface ApplyAssistantResultsInput {
  raw: unknown;
  productDir: string;
  productId: string;
  context: PriorityContext;
  evaluation: PriorityEvaluation;
  now?: string;
}

export interface ApplyAssistantResultsOutput {
  applied: string[];
  errors: string[];
}

export async function applyAssistantResults(
  input: ApplyAssistantResultsInput,
): Promise<ApplyAssistantResultsOutput> {
  const validation = validateAssistantResponse(input.raw, input.context, input.evaluation);
  const applied: string[] = [];
  const errors = [...validation.errors];
  const now = input.now ?? new Date().toISOString();
  for (const result of validation.valid) {
    const state = input.evaluation.byId.get(result.id);
    if (!state) continue;
    try {
      await mutateIssue(
        input.productDir,
        input.productId,
        result.id,
        (issue) => {
          issue.priority = {
            ...issue.priority,
            tier: result.tier,
            reason: result.reason,
            basis: result.basis,
            ...(result.order !== undefined ? { order: result.order } : {}),
            judged_at: now,
            input_hash: result.input_hash,
            source: 'assistant',
          };
        },
        { expectedUpdatedAt: state.issue.updated_at },
      );
      applied.push(result.id);
    } catch (error) {
      errors.push(`${result.id} 写入失败：${errorMessage(error)}`);
    }
  }
  return { applied, errors };
}
