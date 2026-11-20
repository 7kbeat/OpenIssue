import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { OpenIssueError, errorMessage } from '../core/errors.js';
import { contentHash } from '../core/hash.js';
import { isRecord } from '../core/guards.js';
import { isValidChangeId } from '../core/id.js';
import type { Issue, ProposalLink } from '../core/types.js';
import { writeTextAtomic } from '../storage/atomic.js';
import { mutateIssue } from '../storage/issue.js';

export type OpenspecRunner = (args: string[], cwd: string) => Promise<string>;

export interface ProposalState extends ProposalLink {
  state: 'active' | 'archived' | 'missing';
  updated_since_proposal: boolean;
}

export interface HandoffState {
  proposals: ProposalState[];
  archived_pending: boolean;
  link_invalid: boolean;
  updated_since_proposal: boolean;
}

export interface CreateProposalInput {
  anchorRoot: string;
  productDir: string;
  productId: string;
  issue: Issue;
  changeId: string;
  focus: string;
  runner?: OpenspecRunner;
}

export interface LinkProposalInput {
  anchorRoot: string;
  productDir: string;
  productId: string;
  issue: Issue;
  changeId: string;
}

export function composeChangeDescription(issue: Issue, focus: string): string {
  const parts = [`需求 ${issue.id}：${issue.title}`];
  if (issue.description.trim()) parts.push(issue.description.trim());
  if (focus.trim()) parts.push(`当前重点：${focus.trim()}`);
  return parts.join('\n\n');
}

export async function createProposal(input: CreateProposalInput): Promise<Issue> {
  const { anchorRoot, productDir, productId, issue, changeId, focus } = input;
  if (!isValidChangeId(changeId)) {
    throw new OpenIssueError(
      '变更标识只能包含小写字母、数字与连字符，且不能以连字符开头',
      'INVALID_CHANGE_ID',
    );
  }
  ensureOpenspec(anchorRoot);
  const changeDir = path.join(anchorRoot, 'openspec', 'changes', changeId);
  if (existsSync(changeDir) || (await findArchivedChange(anchorRoot, changeId))) {
    throw new OpenIssueError(`提案 ${changeId} 已存在`, 'CHANGE_NAME_CONFLICT');
  }
  if (issue.proposals.some((proposal) => proposal.id === changeId)) {
    throw new OpenIssueError(`需求已关联提案 ${changeId}`, 'PROPOSAL_ALREADY_LINKED');
  }

  const existedBefore = existsSync(changeDir);
  const runner = input.runner ?? defaultOpenspecRunner;
  const preserved = await preservedProposalLinks(anchorRoot, issue);
  let created = false;
  try {
    const description = composeChangeDescription(issue, focus);
    await runner(
      ['new', 'change', changeId, '--description', description, '--json'],
      anchorRoot,
    );
    created = true;
    await addIssueToChangeMetadata(anchorRoot, changeId, issue.id);
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
    if (!existedBefore && (!created || existsSync(changeDir))) {
      await rm(changeDir, { recursive: true, force: true }).catch(() => undefined);
    }
    throw error;
  }
}

export async function linkProposal(input: LinkProposalInput): Promise<Issue> {
  const { anchorRoot, productDir, productId, issue, changeId } = input;
  ensureOpenspec(anchorRoot);
  const changeDir = path.join(anchorRoot, 'openspec', 'changes', changeId);
  if (!existsSync(changeDir)) {
    throw new OpenIssueError(`找不到活跃提案 ${changeId}`, 'CHANGE_NOT_FOUND');
  }
  if (issue.proposals.some((proposal) => proposal.id === changeId)) {
    throw new OpenIssueError(`需求已关联提案 ${changeId}`, 'PROPOSAL_ALREADY_LINKED');
  }
  const original = await readChangeMetadata(anchorRoot, changeId);
  const preserved = await preservedProposalLinks(anchorRoot, issue);
  try {
    await writeChangeMetadata(anchorRoot, changeId, addIssueId(original, issue.id));
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

export async function readHandoffState(
  anchorRoot: string,
  issue: Issue,
): Promise<HandoffState> {
  const proposals: ProposalState[] = [];
  for (const link of issue.proposals) {
    const active = existsSync(path.join(anchorRoot, link.path));
    const archived = active ? undefined : await findArchivedChange(anchorRoot, link.id);
    const state = active ? 'active' : archived ? 'archived' : 'missing';
    proposals.push({
      ...link,
      state,
      updated_since_proposal:
        contentHash(issue.title, issue.description) !== link.snapshot_hash,
    });
  }
  return {
    proposals,
    archived_pending:
      issue.status === 'open' &&
      proposals.length > 0 &&
      proposals.every((proposal) => proposal.state === 'archived'),
    link_invalid: proposals.some((proposal) => proposal.state === 'missing'),
    updated_since_proposal: proposals.some((proposal) => proposal.updated_since_proposal),
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
    .map(({ state: _state, updated_since_proposal: _updated, ...link }) => link);
}

async function addIssueToChangeMetadata(
  anchorRoot: string,
  changeId: string,
  issueId: string,
): Promise<void> {
  const metadata = await readChangeMetadata(anchorRoot, changeId);
  await writeChangeMetadata(anchorRoot, changeId, addIssueId(metadata, issueId));
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

function ensureOpenspec(anchorRoot: string): void {
  if (!existsSync(path.join(anchorRoot, 'openspec', 'config.yaml'))) {
    throw new OpenIssueError(
      '锚点仓库尚未初始化 OpenSpec，请先运行 openspec init',
      'OPENSPEC_NOT_INITIALIZED',
    );
  }
}

export async function defaultOpenspecRunner(
  args: string[],
  cwd: string,
): Promise<string> {
  const command = openspecCommand(args);
  try {
    return execFileSync(command.file, command.args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    const stderr =
      isRecord(error) && typeof error.stderr === 'string' ? error.stderr.trim() : '';
    const stdout =
      isRecord(error) && typeof error.stdout === 'string' ? error.stdout.trim() : '';
    throw new OpenIssueError(
      `OpenSpec 命令失败：${stderr || stdout || errorMessage(error)}`,
      'OPENSPEC_FAILED',
    );
  }
}

function openspecCommand(args: string[]): { file: string; args: string[] } {
  const configured = process.env.OPENSPEC_BIN?.trim();
  if (configured) {
    if (configured.endsWith('.js') || configured.endsWith('.mjs') || configured.endsWith('.cjs')) {
      return { file: process.execPath, args: [configured, ...args] };
    }
    return { file: configured, args };
  }
  if (process.platform === 'win32') {
    const candidate = path.join(
      process.env.APPDATA ?? '',
      'npm',
      'node_modules',
      '@fission-ai',
      'openspec',
      'bin',
      'openspec.js',
    );
    if (existsSync(candidate)) {
      return { file: process.execPath, args: [candidate, ...args] };
    }
    return {
      file: process.env.ComSpec ?? 'cmd.exe',
      args: ['/d', '/s', '/c', `openspec ${args.map(quoteCmdArgument).join(' ')}`],
    };
  }
  return { file: 'openspec', args };
}

function quoteCmdArgument(value: string): string {
  const safe = value
    .replace(/"/g, "'")
    .replace(/%/g, '％')
    .replace(/[\r\n]+/g, ' ')
    .replace(/[&|<>^]/g, ' ');
  return `"${safe}"`;
}
