import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { OpenIssueError } from '../core/errors.js';
import { contentHash } from '../core/hash.js';
import { isRecord } from '../core/guards.js';
import { isValidChangeId, suggestChangeId } from '../core/id.js';
import type { Issue, ProposalLink } from '../core/types.js';
import { writeTextAtomic } from '../storage/atomic.js';
import { mutateIssue, publicIssue } from '../storage/issue.js';

export interface InterviewState {
  status: 'incomplete' | 'completed';
  issue: string;
  started_at: string;
  updated_at: string;
  completed_at?: string;
}

export interface ProposalState extends ProposalLink {
  state: 'active' | 'archived' | 'missing';
  updated_since_proposal: boolean;
  interview?: InterviewState;
  interview_unknown?: boolean;
}

export interface HandoffState {
  proposals: ProposalState[];
  archived_pending: boolean;
  link_invalid: boolean;
  updated_since_proposal: boolean;
  interview_incomplete: boolean;
  interview_completed: boolean;
  interview_unknown: boolean;
  interview_change_ids: string[];
  interview_completed_change_ids: string[];
  resume_change_id?: string;
}

export interface LinkProposalInput {
  anchorRoot: string;
  productDir: string;
  productId: string;
  issue: Issue;
  changeId: string;
  fromInterview?: boolean;
}

export interface StartProposal {
  id: string;
  path: string;
  state: 'active' | 'archived' | 'missing';
  interview_status: 'none' | 'incomplete' | 'completed' | 'unknown';
}

export interface StartContext {
  issue: Record<string, unknown>;
  focus: string;
  suggested_change_id: string;
  active_proposals: StartProposal[];
  archived_proposals: StartProposal[];
  missing_proposals: StartProposal[];
  selection_required: boolean;
  resume_change_id?: string;
  interview: {
    status: 'none' | 'incomplete' | 'completed' | 'unknown';
    change_ids: string[];
  };
  skill_available: boolean;
  instruction: string;
}

export interface BuildStartContextInput {
  issue: Issue;
  focus: string;
  handoff?: HandoffState;
  changeId?: string;
  skillAvailable?: boolean;
}

export function emptyHandoffState(): HandoffState {
  return {
    proposals: [],
    archived_pending: false,
    link_invalid: false,
    updated_since_proposal: false,
    interview_incomplete: false,
    interview_completed: false,
    interview_unknown: false,
    interview_change_ids: [],
    interview_completed_change_ids: [],
  };
}

export function buildStartContext(input: BuildStartContextInput): StartContext {
  const handoff = input.handoff ?? emptyHandoffState();
  const suggested = input.changeId?.trim() || suggestChangeId(input.issue.title, input.issue.id);
  if (!isValidChangeId(suggested)) {
    throw new OpenIssueError(
      '变更标识只能包含小写字母、数字与连字符，且不能以连字符开头',
      'INVALID_CHANGE_ID',
    );
  }
  const toStartProposal = (proposal: ProposalState): StartProposal => ({
    id: proposal.id,
    path: proposal.path,
    state: proposal.state,
    interview_status: proposal.interview
      ? proposal.interview.status
      : proposal.interview_unknown
        ? 'unknown'
        : 'none',
  });
  const active = handoff.proposals.filter((proposal) => proposal.state === 'active').map(toStartProposal);
  const archived = handoff.proposals
    .filter((proposal) => proposal.state === 'archived')
    .map(toStartProposal);
  const missing = handoff.proposals
    .filter((proposal) => proposal.state === 'missing')
    .map(toStartProposal);
  const skillAvailable = input.skillAvailable ?? true;
  const interviewStatus: StartContext['interview']['status'] = handoff.interview_incomplete
    ? 'incomplete'
    : handoff.interview_unknown
      ? 'unknown'
      : handoff.interview_completed
        ? 'completed'
        : 'none';
  return {
    issue: publicIssue(input.issue),
    focus: input.focus,
    suggested_change_id: suggested,
    active_proposals: active,
    archived_proposals: archived,
    missing_proposals: missing,
    selection_required: active.length > 1,
    ...(handoff.resume_change_id ? { resume_change_id: handoff.resume_change_id } : {}),
    interview: {
      status: interviewStatus,
      change_ids: handoff.interview_change_ids,
    },
    skill_available: skillAvailable,
    instruction: buildStartInstruction({
      issue: input.issue,
      focus: input.focus,
      suggested,
      active,
      archived,
      missing,
      ...(handoff.resume_change_id ? { resumeChangeId: handoff.resume_change_id } : {}),
      selectionRequired: active.length > 1,
      skillAvailable,
    }),
  };
}

function buildStartInstruction(input: {
  issue: Issue;
  focus: string;
  suggested: string;
  active: StartProposal[];
  archived: StartProposal[];
  missing: StartProposal[];
  resumeChangeId?: string;
  selectionRequired: boolean;
  skillAvailable: boolean;
}): string {
  const lines = [
    '请使用 openissue-grill-me 技能开始产品决策访谈。',
    `需求：${input.issue.id} ${input.issue.title}`,
  ];
  if (input.issue.description.trim()) lines.push(`描述：${input.issue.description.trim()}`);
  if (input.focus.trim()) lines.push(`当前重点：${input.focus.trim()}`);
  if (!input.skillAvailable) {
    lines.push('当前仓库未安装 openissue-grill-me；请先运行 openissue skills install --tool agents。');
  }
  if (input.selectionRequired) {
    const ids = input.active.map((proposal) => proposal.id).join('、');
    lines.push(
      `检测到多个活跃提案：${ids}。先让用户选择要接管的提案，不要自行选择，也不要创建第二份草稿。选择后运行 openissue handoff ${input.issue.id} --link <change> --from-interview 补写访谈标记。`,
    );
  } else if (input.active.length === 1) {
    const active = input.active[0]!;
    if (active.interview_status === 'incomplete') {
      lines.push(`继续未完成草稿 ${active.id}；不要创建第二份草稿。`);
    } else if (active.interview_status === 'completed') {
      lines.push(
        `活跃提案 ${active.id} 的访谈已完成；不要重复访谈或重置访谈状态，仅在用户明确要求补充决策时继续更新规划产物。`,
      );
    } else {
      lines.push(
        `接管活跃提案 ${active.id}；运行 openissue handoff ${input.issue.id} --link ${active.id} --from-interview 补写访谈标记，保留已有正文。`,
      );
    }
  } else if (input.archived.length > 0) {
    const ids = input.archived.map((proposal) => proposal.id).join('、');
    lines.push(`已有归档提案：${ids}。归档提案不能被接管；由用户决定重新关联或新建。`);
  } else {
    lines.push(
      `创建草稿 ${input.suggested}：运行 openspec new change ${input.suggested} --description "<需求上下文>" --json，然后运行 openissue handoff ${input.issue.id} --link ${input.suggested} --from-interview。`,
    );
  }
  if (input.missing.length > 0) {
    lines.push(`关联失效的提案：${input.missing.map((proposal) => proposal.id).join('、')}；不要自动覆盖，先让用户重新关联或明确新建。`);
  }
  lines.push('访谈中每确认一项决策，立即按归属写入 proposal、specs 或 design，让用户看到 diff。');
  lines.push('用户明确执行“结束访谈并生成任务”后，先整理规划产物并生成 TDD tasks；若 openissue show 仍显示访谈未完成，再运行 openissue start <id> --complete <change-id> 标记已完成。');
  lines.push('tasks 仅在用户明确执行“结束访谈并生成任务”后生成；生成后停止，不进入实现。');
  lines.push('只有用户明确要求实现后，才进入标准 OpenSpec apply。');
  lines.push('来自 OpenIssue 需求的规划使用本流程；没有需求来源的 OpenSpec 工作继续使用标准 propose。');
  return lines.join('\n');
}

export async function linkProposal(input: LinkProposalInput): Promise<Issue> {
  const { anchorRoot, productDir, productId, issue, changeId, fromInterview = false } = input;
  if (!isValidChangeId(changeId)) {
    throw new OpenIssueError(
      '变更标识只能包含小写字母、数字与连字符，且不能以连字符开头',
      'INVALID_CHANGE_ID',
    );
  }
  ensureOpenspec(anchorRoot);
  const changeDir = path.join(anchorRoot, 'openspec', 'changes', changeId);
  if (!existsSync(changeDir)) {
    throw new OpenIssueError(`找不到活跃提案 ${changeId}`, 'CHANGE_NOT_FOUND');
  }
  const alreadyLinked = issue.proposals.some((proposal) => proposal.id === changeId);
  if (alreadyLinked) {
    if (!fromInterview) {
      throw new OpenIssueError(`需求已关联提案 ${changeId}`, 'PROPOSAL_ALREADY_LINKED');
    }
    await markInterviewStarted(anchorRoot, changeId, issue.id);
    return issue;
  }
  const original = await readChangeMetadata(anchorRoot, changeId);
  const preserved = await preservedProposalLinks(anchorRoot, issue);
  try {
    let metadata = addIssueId(original, issue.id);
    if (fromInterview) metadata = addInterviewMarker(metadata, issue.id, new Date().toISOString());
    await writeChangeMetadata(anchorRoot, changeId, metadata);
    const link: ProposalLink = {
      id: changeId,
      path: `openspec/changes/${changeId}`,
      created_at: new Date().toISOString(),
      snapshot_hash: contentHash(issue.title, issue.description),
    };
    return await mutateIssue(
      productDir,
      productId,
      issue.id,
      (current) => {
        current.proposals = [...preserved, link];
      },
      { expectedUpdatedAt: issue.updated_at },
    );
  } catch (error) {
    await writeChangeMetadata(anchorRoot, changeId, original).catch(() => undefined);
    throw error;
  }
}

export async function markInterviewStarted(
  anchorRoot: string,
  changeId: string,
  issueId: string,
  now = new Date().toISOString(),
): Promise<void> {
  const metadata = await readChangeMetadata(anchorRoot, changeId);
  if (parseInterviewMarker(metadata['x-openissue-interview']).state?.status === 'completed') {
    return;
  }
  await writeChangeMetadata(anchorRoot, changeId, addInterviewMarker(metadata, issueId, now));
}

export async function completeInterview(input: {
  anchorRoot: string;
  issue: Issue;
  changeId: string;
  now?: string;
}): Promise<void> {
  const { anchorRoot, issue, changeId } = input;
  if (!isValidChangeId(changeId)) {
    throw new OpenIssueError(
      '变更标识只能包含小写字母、数字与连字符，且不能以连字符开头',
      'INVALID_CHANGE_ID',
    );
  }
  if (!issue.proposals.some((proposal) => proposal.id === changeId)) {
    throw new OpenIssueError(`需求未关联提案 ${changeId}`, 'PROPOSAL_NOT_LINKED');
  }
  if (!existsSync(path.join(anchorRoot, 'openspec', 'changes', changeId))) {
    throw new OpenIssueError(
      `提案 ${changeId} 不在活跃变更中，不能标记访谈完成`,
      'CHANGE_NOT_FOUND',
    );
  }
  const metadata = await readChangeMetadata(anchorRoot, changeId);
  const parsed = parseInterviewMarker(metadata['x-openissue-interview']);
  if (parsed.unknown) {
    throw new OpenIssueError(
      `提案 ${changeId} 的访谈标记无法读取，不能标记完成`,
      'INTERVIEW_STATE_UNKNOWN',
    );
  }
  if (!parsed.state) {
    throw new OpenIssueError(
      `提案 ${changeId} 不是访谈草稿，不能标记完成`,
      'NOT_INTERVIEW_DRAFT',
    );
  }
  if (parsed.state.status === 'completed') return;
  await writeChangeMetadata(
    anchorRoot,
    changeId,
    completeInterviewMarker(metadata, issue.id, input.now ?? new Date().toISOString()),
  );
}

export async function discardInterview(input: {
  anchorRoot: string;
  productDir: string;
  productId: string;
  issue: Issue;
  changeId: string;
}): Promise<Issue> {
  const { anchorRoot, productDir, productId, issue, changeId } = input;
  if (!isValidChangeId(changeId)) {
    throw new OpenIssueError(
      '变更标识只能包含小写字母、数字与连字符，且不能以连字符开头',
      'INVALID_CHANGE_ID',
    );
  }
  const link = issue.proposals.find((proposal) => proposal.id === changeId);
  if (!link) throw new OpenIssueError(`需求未关联提案 ${changeId}`, 'PROPOSAL_NOT_LINKED');
  const changeDir = path.join(anchorRoot, 'openspec', 'changes', changeId);
  if (!existsSync(changeDir)) {
    throw new OpenIssueError(`提案 ${changeId} 不在活跃变更中，不能丢弃`, 'CHANGE_NOT_FOUND');
  }
  const metadata = await readChangeMetadata(anchorRoot, changeId);
  const parsed = parseInterviewMarker(metadata['x-openissue-interview']);
  if (!parsed.state || parsed.state.status !== 'incomplete') {
    throw new OpenIssueError(
      `提案 ${changeId} 不是未完成的访谈草稿，不能丢弃`,
      'NOT_INTERVIEW_DRAFT',
    );
  }
  const backup = path.join(
    anchorRoot,
    'openspec',
    'changes',
    `.openissue-discard-${changeId}-${Date.now()}`,
  );
  await rename(changeDir, backup);
  try {
    const updated = await mutateIssue(
      productDir,
      productId,
      issue.id,
      (current) => {
        current.proposals = current.proposals.filter((proposal) => proposal.id !== changeId);
      },
      { expectedUpdatedAt: issue.updated_at },
    );
    try {
      await rm(backup, { recursive: true, force: true });
    } catch (error) {
      await mutateIssue(productDir, productId, issue.id, (current) => {
        if (!current.proposals.some((proposal) => proposal.id === changeId)) {
          current.proposals.push(link);
        }
      }).catch(() => undefined);
      await rename(backup, changeDir).catch(() => undefined);
      throw error;
    }
    return updated;
  } catch (error) {
    await rename(backup, changeDir).catch(() => undefined);
    throw error;
  }
}

export async function readHandoffState(
  anchorRoot: string,
  issue: Issue,
): Promise<HandoffState> {
  const proposals: ProposalState[] = [];
  for (const link of issue.proposals) {
    const active = existsSync(path.join(anchorRoot, link.path));
    const archived = active ? undefined : await findArchivedChange(anchorRoot, link.id);
    const state = active ? 'active' : archived ? 'archived' : 'missing';
    let interview: InterviewState | undefined;
    let interviewUnknown = false;
    if (state !== 'missing') {
      try {
        const metadata = await readChangeMetadata(anchorRoot, link.id);
        const parsed = parseInterviewMarker(metadata['x-openissue-interview']);
        interview = parsed.state;
        interviewUnknown = parsed.unknown;
      } catch {
        interviewUnknown = true;
      }
    }
    proposals.push({
      ...link,
      state,
      updated_since_proposal:
        contentHash(issue.title, issue.description) !== link.snapshot_hash,
      ...(interview ? { interview } : {}),
      ...(interviewUnknown ? { interview_unknown: true } : {}),
    });
  }
  const activeInterviewIds = proposals
    .filter(
      (proposal) =>
        proposal.state === 'active' && proposal.interview?.status === 'incomplete',
    )
    .map((proposal) => proposal.id);
  const activeCompletedInterviewIds = proposals
    .filter(
      (proposal) =>
        proposal.state === 'active' && proposal.interview?.status === 'completed',
    )
    .map((proposal) => proposal.id);
  return {
    proposals,
    archived_pending:
      issue.status === 'open' &&
      proposals.length > 0 &&
      proposals.every((proposal) => proposal.state === 'archived'),
    link_invalid: proposals.some((proposal) => proposal.state === 'missing'),
    updated_since_proposal: proposals.some((proposal) => proposal.updated_since_proposal),
    interview_incomplete: activeInterviewIds.length > 0,
    interview_completed: activeCompletedInterviewIds.length > 0,
    interview_unknown: proposals.some(
      (proposal) => proposal.state !== 'missing' && proposal.interview_unknown,
    ),
    interview_change_ids: activeInterviewIds,
    interview_completed_change_ids: activeCompletedInterviewIds,
    ...(activeInterviewIds.length === 1 ? { resume_change_id: activeInterviewIds[0]! } : {}),
  };
}

export async function confirmDone(
  productDir: string,
  productId: string,
  anchorRoot: string,
  issue: Issue,
): Promise<Issue> {
  const state = await readHandoffState(anchorRoot, issue);
  if (issue.status !== 'open') {
    throw new OpenIssueError('需求已关闭，不需要再次确认完成', 'ALREADY_CLOSED');
  }
  if (!state.archived_pending) {
    throw new OpenIssueError('只有全部关联提案都已归档时才能确认完成', 'NOT_READY');
  }
  return mutateIssue(
    productDir,
    productId,
    issue.id,
    (current) => {
      current.status = 'closed';
      current.close = {
        reason: 'completed',
        closed_at: new Date().toISOString(),
      };
    },
    { expectedUpdatedAt: issue.updated_at },
  );
}

export async function findArchivedChange(
  anchorRoot: string,
  changeId: string,
): Promise<string | undefined> {
  const archiveRoot = path.join(anchorRoot, 'openspec', 'changes', 'archive');
  let entries: string[];
  try {
    entries = await readdir(archiveRoot);
  } catch {
    return undefined;
  }
  const match = entries.find(
    (name) => name === changeId || name.endsWith(`-${changeId}`),
  );
  return match ? path.join(archiveRoot, match) : undefined;
}

export async function archiveChange(input: {
  anchorRoot: string;
  changeId: string;
  now?: string;
}): Promise<void> {
  if (!isValidChangeId(input.changeId)) {
    throw new OpenIssueError(
      '变更标识只能包含小写字母、数字与连字符，且不能以连字符开头',
      'INVALID_CHANGE_ID',
    );
  }
  const changesRoot = path.join(input.anchorRoot, 'openspec', 'changes');
  const source = path.join(changesRoot, input.changeId);
  if (!existsSync(source)) {
    throw new OpenIssueError(`找不到活跃提案 ${input.changeId}`, 'CHANGE_NOT_FOUND');
  }
  const now = input.now ?? new Date().toISOString();
  const archiveRoot = path.join(changesRoot, 'archive');
  const prefix = now.slice(0, 10);
  const destination = path.join(archiveRoot, `${prefix}-${input.changeId}`);
  if (existsSync(destination)) {
    throw new OpenIssueError(`归档目录已存在：${path.basename(destination)}`, 'ARCHIVE_EXISTS');
  }
  await mkdir(archiveRoot, { recursive: true });
  const metadataPath = path.join(source, '.openspec.yaml');
  const raw = existsSync(metadataPath)
    ? await readFile(metadataPath, 'utf8')
    : '';
  const metadata = raw.trim() ? YAML.parse(raw) : {};
  if (!isRecord(metadata)) {
    throw new OpenIssueError('提案元数据格式无效，无法归档', 'INVALID_CHANGE_METADATA');
  }
  await writeTextAtomic(
    metadataPath,
    YAML.stringify({ ...metadata, archived_at: now }, { lineWidth: 0 }),
  );
  try {
    await rename(source, destination);
  } catch (error) {
    await writeTextAtomic(metadataPath, raw).catch(() => undefined);
    throw error;
  }
}

export async function readChangeMetadata(
  anchorRoot: string,
  changeId: string,
): Promise<Record<string, unknown>> {
  const dir = path.join(anchorRoot, 'openspec', 'changes', changeId);
  const active = path.join(dir, '.openspec.yaml');
  const archived = await findArchivedChange(anchorRoot, changeId);
  const file = existsSync(active)
    ? active
    : archived
      ? path.join(archived, '.openspec.yaml')
      : undefined;
  if (!file) throw new OpenIssueError(`找不到提案元数据 ${changeId}`, 'CHANGE_NOT_FOUND');
  const parsed = YAML.parse(await readFile(file, 'utf8'));
  if (!isRecord(parsed)) {
    throw new OpenIssueError(`提案元数据格式无效：${changeId}`, 'INVALID_CHANGE_METADATA');
  }
  return parsed;
}

async function writeChangeMetadata(
  anchorRoot: string,
  changeId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  const dir = path.join(anchorRoot, 'openspec', 'changes', changeId);
  const active = path.join(dir, '.openspec.yaml');
  const archived = await findArchivedChange(anchorRoot, changeId);
  const file = existsSync(active)
    ? active
    : archived
      ? path.join(archived, '.openspec.yaml')
      : undefined;
  if (!file) throw new OpenIssueError(`找不到提案元数据 ${changeId}`, 'CHANGE_NOT_FOUND');
  await writeTextAtomic(file, YAML.stringify(metadata, { lineWidth: 0 }));
}

async function preservedProposalLinks(
  anchorRoot: string,
  issue: Issue,
): Promise<ProposalLink[]> {
  const state = await readHandoffState(anchorRoot, issue);
  return state.proposals
    .filter((proposal) => proposal.state !== 'missing')
    .map(
      ({ state: _state, updated_since_proposal: _updated, interview: _interview, interview_unknown: _unknown, ...link }) =>
        link,
    );
}

function addIssueId(
  metadata: Record<string, unknown>,
  issueId: string,
): Record<string, unknown> {
  const current = Array.isArray(metadata['x-openissue-issues'])
    ? metadata['x-openissue-issues'].filter(
        (item): item is string => typeof item === 'string',
      )
    : [];
  if (!current.includes(issueId)) current.push(issueId);
  return { ...metadata, 'x-openissue-issues': current };
}

function addInterviewMarker(
  metadata: Record<string, unknown>,
  issueId: string,
  now: string,
): Record<string, unknown> {
  const current = isRecord(metadata['x-openissue-interview'])
    ? metadata['x-openissue-interview']
    : {};
  const startedAt =
    typeof current.started_at === 'string' && current.started_at.trim()
      ? current.started_at
      : now;
  return {
    ...metadata,
    'x-openissue-interview': {
      ...current,
      status: 'incomplete',
      issue: issueId,
      started_at: startedAt,
      updated_at: now,
    },
  };
}

function completeInterviewMarker(
  metadata: Record<string, unknown>,
  issueId: string,
  now: string,
): Record<string, unknown> {
  const current = isRecord(metadata['x-openissue-interview'])
    ? metadata['x-openissue-interview']
    : {};
  const startedAt =
    typeof current.started_at === 'string' && current.started_at.trim()
      ? current.started_at
      : now;
  return {
    ...metadata,
    'x-openissue-interview': {
      ...current,
      status: 'completed',
      issue: issueId,
      started_at: startedAt,
      updated_at: now,
      completed_at: now,
    },
  };
}

function parseInterviewMarker(value: unknown): {
  state?: InterviewState;
  unknown: boolean;
} {
  if (value === undefined) return { unknown: false };
  if (!isRecord(value)) return { unknown: true };
  if (typeof value.status !== 'string') return { unknown: true };
  if (value.status !== 'incomplete' && value.status !== 'completed') return { unknown: true };
  if (
    typeof value.issue !== 'string' ||
    !value.issue.trim() ||
    typeof value.started_at !== 'string' ||
    typeof value.updated_at !== 'string'
  ) {
    return { unknown: true };
  }
  const completedAt =
    typeof value.completed_at === 'string' && value.completed_at.trim()
      ? value.completed_at
      : undefined;
  return {
    state: {
      status: value.status,
      issue: value.issue,
      started_at: value.started_at,
      updated_at: value.updated_at,
      ...(value.status === 'completed' && completedAt
        ? { completed_at: completedAt }
        : {}),
    },
    unknown: false,
  };
}

function ensureOpenspec(anchorRoot: string): void {
  if (!existsSync(path.join(anchorRoot, 'openspec', 'config.yaml'))) {
    throw new OpenIssueError(
      '锚点仓库尚未初始化 OpenSpec，请先运行 openspec init',
      'OPENSPEC_NOT_INITIALIZED',
    );
  }
}
