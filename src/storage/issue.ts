import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { OpenIssueError } from '../core/errors.js';
import { isRecord } from '../core/guards.js';
import { toPosix } from '../core/paths.js';
import type {
  CloseInfo,
  CloseReason,
  Issue,
  IssueCollection,
  IssueConflict,
  IssueStatus,
  PriorityCache,
  ProposalLink,
  Tier,
} from '../core/types.js';
import { writeTextAtomic } from './atomic.js';
import { parseMarkdown, serializeMarkdown } from './frontmatter.js';

const TIERS: Tier[] = ['high', 'medium', 'low'];
const CLOSE_REASONS: CloseReason[] = ['completed', 'wontdo'];

export function issuesDirectory(productDir: string): string {
  return path.join(productDir, 'issues');
}

export function issueFilePath(productDir: string, id: string): string {
  return path.join(issuesDirectory(productDir), `${id}.md`);
}

export function parseIssue(raw: string, filePath: string, productId: string): Issue {
  const { frontmatter, body } = parseMarkdown(raw);
  const id = requiredString(frontmatter, 'id');
  const title = requiredString(frontmatter, 'title');
  if (!title.trim()) throw new OpenIssueError('需求标题不能为空', 'INVALID_ISSUE');
  const status = requiredString(frontmatter, 'status');
  if (status !== 'open' && status !== 'closed') {
    throw new OpenIssueError(`未知的需求状态：${status}`, 'INVALID_ISSUE');
  }
  const declaredProduct = optionalString(frontmatter, 'product') ?? productId;
  const createdAt = requiredString(frontmatter, 'created_at');
  const updatedAt = optionalString(frontmatter, 'updated_at') ?? createdAt;
  const author = optionalString(frontmatter, 'author') ?? 'unknown';
  const source = optionalString(frontmatter, 'source') === 'board' ? 'board' : 'cli';
  const close = parseClose(frontmatter.close, status);
  const blockedBy = parseStringArray(frontmatter.blocked_by, 'blocked_by');
  const proposals = parseProposals(frontmatter.proposals);
  const priority = parsePriority(frontmatter.priority);
  return {
    id,
    title,
    description: body.replace(/\r\n/g, '\n').replace(/\n+$/g, ''),
    status: status as IssueStatus,
    product: declaredProduct,
    created_at: createdAt,
    updated_at: updatedAt,
    author,
    source,
    ...(close ? { close } : {}),
    blocked_by: blockedBy,
    proposals,
    priority,
    filePath,
    rawFrontmatter: frontmatter,
  };
}

export async function loadIssues(productDir: string, productId: string): Promise<IssueCollection> {
  const dir = issuesDirectory(productDir);
  let files: string[];
  try {
    files = (await readdir(dir)).filter((name) => name.endsWith('.md')).sort();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return { issues: [], conflicts: [] };
    throw error;
  }
  const issues: Issue[] = [];
  const conflicts: IssueConflict[] = [];
  const seen = new Map<string, string>();
  for (const name of files) {
    const filePath = path.join(dir, name);
    const relativePath = toPosix(path.relative(productDir, filePath));
    let raw = '';
    try {
      raw = await readFile(filePath, 'utf8');
      const issue = parseIssue(raw, filePath, productId);
      const existing = seen.get(issue.id);
      if (existing) {
        conflicts.push({
          filePath,
          relativePath,
          raw,
          error: `重复的需求标识 ${issue.id}，已存在于 ${existing}`,
        });
        continue;
      }
      seen.set(issue.id, relativePath);
      issues.push(issue);
    } catch (error) {
      conflicts.push({
        filePath,
        relativePath,
        raw,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  issues.sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  return { issues, conflicts };
}

export async function findIssue(
  productDir: string,
  productId: string,
  id: string,
): Promise<Issue> {
  const collection = await loadIssues(productDir, productId);
  const issue = collection.issues.find((item) => item.id === id);
  if (!issue) {
    throw new OpenIssueError(`找不到需求 ${id}`, 'ISSUE_NOT_FOUND');
  }
  return issue;
}

export async function writeIssue(productDir: string, issue: Issue): Promise<void> {
  const content = serializeIssue(issue);
  await writeTextAtomic(issue.filePath, content);
}

export function serializeIssue(issue: Issue): string {
  const frontmatter: Record<string, unknown> = { ...issue.rawFrontmatter };
  frontmatter.id = issue.id;
  frontmatter.title = issue.title;
  frontmatter.status = issue.status;
  frontmatter.product = issue.product;
  frontmatter.created_at = issue.created_at;
  frontmatter.updated_at = issue.updated_at;
  frontmatter.author = issue.author;
  frontmatter.source = issue.source;
  if (issue.close) {
    frontmatter.close = {
      ...(isRecord(issue.rawFrontmatter.close) ? issue.rawFrontmatter.close : {}),
      reason: issue.close.reason,
      ...(issue.close.note ? { note: issue.close.note } : {}),
      closed_at: issue.close.closed_at,
    };
  } else {
    delete frontmatter.close;
  }
  frontmatter.blocked_by = issue.blocked_by;
  frontmatter.proposals = issue.proposals;
  if (Object.keys(issue.priority).length > 0) {
    frontmatter.priority = {
      ...(isRecord(issue.rawFrontmatter.priority) ? issue.rawFrontmatter.priority : {}),
      ...issue.priority,
    };
  } else if (isRecord(issue.rawFrontmatter.priority)) {
    frontmatter.priority = issue.rawFrontmatter.priority;
  } else {
    delete frontmatter.priority;
  }
  delete frontmatter.description;
  return serializeMarkdown(frontmatter, issue.description);
}

export async function mutateIssue(
  productDir: string,
  productId: string,
  id: string,
  mutator: (issue: Issue) => void | Promise<void>,
  options: { expectedUpdatedAt?: string; now?: string } = {},
): Promise<Issue> {
  const issue = await findIssue(productDir, productId, id);
  if (options.expectedUpdatedAt && issue.updated_at !== options.expectedUpdatedAt) {
    throw new OpenIssueError(
      '需求在读取后被外部修改，请刷新后重试',
      'CONCURRENT_MODIFICATION',
      2,
    );
  }
  await mutator(issue);
  issue.updated_at = options.now ?? new Date().toISOString();
  await writeIssue(productDir, issue);
  return issue;
}

export function publicIssue(issue: Issue): Record<string, unknown> {
  const { rawFrontmatter: _raw, filePath: _filePath, ...rest } = issue;
  return rest;
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new OpenIssueError(`需求缺少字段 ${key}`, 'INVALID_ISSUE');
  }
  return value;
}

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function parseClose(value: unknown, status: IssueStatus): CloseInfo | undefined {
  if (value === undefined || value === null) {
    if (status === 'closed') {
      throw new OpenIssueError('已关闭需求缺少关闭原因', 'INVALID_ISSUE');
    }
    return undefined;
  }
  if (!isRecord(value)) throw new OpenIssueError('close 字段必须是对象', 'INVALID_ISSUE');
  const reason = value.reason;
  if (reason !== 'completed' && reason !== 'wontdo') {
    throw new OpenIssueError('关闭原因必须是 completed 或 wontdo', 'INVALID_ISSUE');
  }
  const note = optionalString(value, 'note');
  if (reason === 'wontdo' && !note) {
    throw new OpenIssueError('关闭原因为不做时必须填写原因', 'INVALID_ISSUE');
  }
  const closedAt = optionalString(value, 'closed_at') ?? new Date(0).toISOString();
  return {
    reason,
    ...(note ? { note } : {}),
    closed_at: closedAt,
  };
}

function parseStringArray(value: unknown, field: string): string[] {
  if (value === undefined || value === null) return [];
  if (typeof value === 'string') return [value];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new OpenIssueError(`${field} 必须是字符串数组`, 'INVALID_ISSUE');
  }
  return [...new Set(value as string[])];
}

function parseProposals(value: unknown): ProposalLink[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new OpenIssueError('proposals 必须是数组', 'INVALID_ISSUE');
  return value.map((item) => {
    if (!isRecord(item) || typeof item.id !== 'string' || !item.id.trim()) {
      throw new OpenIssueError('提案关联缺少 id', 'INVALID_ISSUE');
    }
    return {
      id: item.id,
      path: typeof item.path === 'string' ? item.path : `openspec/changes/${item.id}`,
      created_at:
        typeof item.created_at === 'string' ? item.created_at : new Date(0).toISOString(),
      snapshot_hash: typeof item.snapshot_hash === 'string' ? item.snapshot_hash : '',
    };
  });
}

function parsePriority(value: unknown): PriorityCache {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) throw new OpenIssueError('priority 必须是对象', 'INVALID_ISSUE');
  const result: PriorityCache = {};
  if (value.tier !== undefined) {
    if (!TIERS.includes(value.tier as Tier)) {
      throw new OpenIssueError('priority.tier 必须是 high、medium 或 low', 'INVALID_ISSUE');
    }
    result.tier = value.tier as Tier;
  }
  if (value.manual_tier !== undefined) {
    if (!TIERS.includes(value.manual_tier as Tier)) {
      throw new OpenIssueError('priority.manual_tier 必须是 high、medium 或 low', 'INVALID_ISSUE');
    }
    result.manual_tier = value.manual_tier as Tier;
  }
  if (value.order !== undefined) {
    if (typeof value.order !== 'number' || !Number.isFinite(value.order)) {
      throw new OpenIssueError('priority.order 必须是数字', 'INVALID_ISSUE');
    }
    result.order = value.order;
  }
  for (const key of ['reason', 'judged_at', 'input_hash', 'manual_at'] as const) {
    if (value[key] !== undefined) {
      if (typeof value[key] !== 'string') {
        throw new OpenIssueError(`priority.${key} 必须是字符串`, 'INVALID_ISSUE');
      }
      result[key] = value[key];
    }
  }
  if (value.source !== undefined) {
    if (value.source !== 'assistant' && value.source !== 'manual' && value.source !== 'rule') {
      throw new OpenIssueError('priority.source 非法', 'INVALID_ISSUE');
    }
    result.source = value.source;
  }
  if (value.basis !== undefined) {
    result.basis = parseStringArray(value.basis, 'priority.basis');
  }
  return result;
}
