import { sha256, stableJson } from '../core/hash.js';
import { isRecord } from '../core/guards.js';
import type { ProjectFacts, ProductManifest, Tier } from '../core/types.js';
import type { EvaluatedIssue, PriorityContext, PriorityEvaluation } from './priority.js';
import { computeIssueInputHash } from './priority.js';

export interface AssistantRequestIssue {
  id: string;
  title: string;
  description: string;
  blocked_by: string[];
  proposals: Array<{
    id: string;
    state: 'active' | 'archived' | 'missing';
    tasks_total: number;
    tasks_done: number;
  }>;
  manual_tier: Tier | null;
  effective_tier: string;
  current_reason: string;
  cached: {
    tier: Tier;
    reason: string;
    judged_at: string | null;
    input_hash: string | null;
  } | null;
  needs_judgment: boolean;
  input_hash: string;
}

export interface AssistantRequest {
  version: 1;
  generated_at: string;
  product: { id: string; name: string };
  focus: string;
  focus_updated_at: string | null;
  facts: ProjectFacts;
  issues: AssistantRequestIssue[];
  request_hash: string;
}

export interface AssistantResult {
  id: string;
  tier: Tier;
  reason: string;
  basis: string[];
  order?: number;
  input_hash: string;
}

export interface AssistantValidation {
  valid: AssistantResult[];
  errors: string[];
}

export function buildAssistantRequest(
  product: ProductManifest,
  context: PriorityContext,
  evaluation: PriorityEvaluation,
  now = new Date().toISOString(),
): AssistantRequest {
  const issues = [...evaluation.byId.values()]
    .sort((a, b) => a.issue.created_at.localeCompare(b.issue.created_at) || a.issue.id.localeCompare(b.issue.id))
    .map((item) => requestIssue(item, context));
  const body = {
    version: 1 as const,
    product: { id: product.id, name: product.name },
    focus: context.focus,
    focus_updated_at: product.focus_updated_at,
    facts: context.facts,
    issues,
  };
  return {
    ...body,
    generated_at: now,
    request_hash: sha256(stableJson(body)),
  };
}

function requestIssue(item: EvaluatedIssue, context: PriorityContext): AssistantRequestIssue {
  const priority = item.issue.priority;
  const cached =
    priority.tier && priority.reason
      ? {
          tier: priority.tier,
          reason: priority.reason,
          judged_at: priority.judged_at ?? null,
          input_hash: priority.input_hash ?? null,
        }
      : null;
  const inputHash = computeIssueInputHash(item.issue, context);
  return {
    id: item.issue.id,
    title: item.issue.title,
    description: item.issue.description,
    blocked_by: [...item.issue.blocked_by].sort(),
    proposals: item.issue.proposals.map((link) => {
      const fact = context.facts.proposals.find((proposal) => proposal.id === link.id);
      return {
        id: link.id,
        state: fact ? (fact.archived ? 'archived' : 'active') : 'missing',
        tasks_total: fact?.tasks_total ?? 0,
        tasks_done: fact?.tasks_done ?? 0,
      };
    }),
    manual_tier: priority.manual_tier ?? null,
    effective_tier: item.tier,
    current_reason: item.reason,
    cached,
    needs_judgment:
      !cached ||
      !priority.input_hash ||
      priority.input_hash !== inputHash,
    input_hash: inputHash,
  };
}

export function validateAssistantResponse(
  raw: unknown,
  context: PriorityContext,
  evaluation: PriorityEvaluation,
): AssistantValidation {
  const valid: AssistantResult[] = [];
  const errors: string[] = [];
  if (!isRecord(raw) || !Array.isArray(raw.results)) {
    return { valid, errors: ['响应必须是包含 results 数组的 JSON 对象'] };
  }
  const seen = new Set<string>();
  for (const [index, item] of raw.results.entries()) {
    const label = `第 ${index + 1} 条结果`;
    if (!isRecord(item)) {
      errors.push(`${label}不是对象`);
      continue;
    }
    const id = typeof item.id === 'string' ? item.id : undefined;
    if (!id) {
      errors.push(`${label}缺少需求 id`);
      continue;
    }
    if (seen.has(id)) {
      errors.push(`${id} 重复出现`);
      continue;
    }
    seen.add(id);
    const evaluated = evaluation.byId.get(id);
    if (!evaluated) {
      errors.push(`${id} 不存在或已关闭，不能写入`);
      continue;
    }
    const tier = item.tier;
    if (tier !== 'high' && tier !== 'medium' && tier !== 'low') {
      errors.push(`${id} 的档位非法，必须是 high、medium 或 low`);
      continue;
    }
    const reason = typeof item.reason === 'string' ? item.reason.trim() : '';
    if (!reason) {
      errors.push(`${id} 的理由不能为空`);
      continue;
    }
    const basis = Array.isArray(item.basis)
      ? item.basis.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      : [];
    if (basis.length === 0) {
      errors.push(`${id} 必须提供至少一项依据`);
      continue;
    }
    const invalidBasis = basis.filter((value) => !basisIsValid(value, evaluated, context));
    if (invalidBasis.length > 0) {
      errors.push(`${id} 的依据无法在请求中找到：${invalidBasis.join('、')}`);
      continue;
    }
    const inputHash = typeof item.input_hash === 'string' ? item.input_hash : '';
    const currentHash = computeIssueInputHash(evaluated.issue, context);
    if (!inputHash) {
      errors.push(`${id} 缺少 input_hash，请重新生成判断请求`);
      continue;
    }
    if (inputHash !== currentHash) {
      errors.push(`${id} 的输入已变化，请重新生成判断请求`);
      continue;
    }
    let order: number | undefined;
    if (item.order !== undefined) {
      if (typeof item.order !== 'number' || !Number.isInteger(item.order) || item.order < 0) {
        errors.push(`${id} 的 order 必须是非负整数`);
        continue;
      }
      order = item.order;
    }
    valid.push({
      id,
      tier: tier as Tier,
      reason,
      basis,
      ...(order !== undefined ? { order } : {}),
      input_hash: inputHash,
    });
  }
  return { valid, errors };
}

function basisIsValid(
  value: string,
  evaluated: EvaluatedIssue,
  context: PriorityContext,
): boolean {
  if (value === 'focus') return context.focus.trim().length > 0;
  if (value.startsWith('spec:')) {
    return context.facts.specs.some((spec) => spec.id === value.slice(5));
  }
  if (value.startsWith('proposal:')) {
    return context.facts.proposals.some((proposal) => proposal.id === value.slice(9));
  }
  if (value.startsWith('dependency:')) {
    return evaluated.issue.blocked_by.includes(value.slice(11));
  }
  return false;
}
