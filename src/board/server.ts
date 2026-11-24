import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { OpenIssueError } from '../core/errors.js';
import type { Issue, ProductManifest } from '../core/types.js';
import { applyManualTier } from '../domain/manual.js';
import { applyClose, applyReopen, parseCloseReason } from '../domain/lifecycle.js';
import {
  confirmDone as defaultConfirmDone,
  linkProposal as defaultLinkProposal,
  type HandoffState,
} from '../services/handoff.js';
import type { EvaluatedIssue } from '../domain/priority.js';
import type { BoardFilters, FilteredEvaluation } from '../domain/search.js';
import { filterEvaluation, parseFilters } from '../domain/search.js';
import { findIssue, mutateIssue, publicIssue } from '../storage/issue.js';
import { updateFocus as defaultUpdateFocus } from '../storage/product.js';
import { loadBoardData, type BoardContext, type BoardData } from './data.js';
import { renderBoardError, renderBoardPage } from './render.js';

export type BoardMutator = (
  productDir: string,
  productId: string,
  id: string,
  mutator: (issue: Issue) => void | Promise<void>,
  options?: { expectedUpdatedAt?: string },
) => Promise<Issue>;

export interface BoardDeps {
  mutate?: BoardMutator;
  updateFocus?: (anchorRoot: string, focus: string) => Promise<ProductManifest>;
  confirm?: (
    productDir: string,
    productId: string,
    anchorRoot: string,
    issue: Issue,
  ) => Promise<Issue>;
  link?: (input: {
    anchorRoot: string;
    productDir: string;
    productId: string;
    issue: Issue;
    changeId: string;
  }) => Promise<Issue>;
}

export interface StartBoardOptions {
  context: BoardContext;
  port?: number;
  host?: string;
  deps?: BoardDeps;
}

export interface BoardServer {
  server: Server;
  url: string;
  close(): Promise<void>;
}

export async function startBoard(options: StartBoardOptions): Promise<BoardServer> {
  const deps = options.deps ?? {};
  const server = createServer((request, response) => {
    handleRequest(options.context, deps, request, response).catch((error: unknown) => {
      sendError(request, response, error);
    });
  });
  const port = options.port ?? 4310;
  const host = options.host ?? '127.0.0.1';
  const listening = Promise.withResolvers<void>();
  const onError = (error: Error) => listening.reject(error);
  server.once('error', onError);
  server.listen(port, host, () => {
    server.off('error', onError);
    listening.resolve();
  });
  await listening.promise;
  const address = server.address() as AddressInfo;
  const displayHost = host === '0.0.0.0' ? '127.0.0.1' : host;
  return {
    server,
    url: `http://${displayHost}:${address.port}/`,
    close: () => {
      const closing = Promise.withResolvers<void>();
      server.close((error) => (error ? closing.reject(error) : closing.resolve()));
      return closing.promise;
    },
  };
}

async function handleRequest(
  context: BoardContext,
  deps: BoardDeps,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  if (request.method === 'GET' && url.pathname === '/') {
    const filters = parseFilters(url.searchParams);
    const data = await loadBoardData(context);
    const filtered = filterEvaluation(data.evaluation, filters, data.issues);
    sendHtml(response, renderBoardPage(data, filters, filtered));
    return;
  }
  if (request.method === 'GET' && url.pathname === '/api/state') {
    const filters = parseFilters(url.searchParams);
    const data = await loadBoardData(context);
    const filtered = filterEvaluation(data.evaluation, filters, data.issues);
    sendJson(response, 200, serializeState(data, filters, filtered));
    return;
  }
  if (request.method === 'POST') {
    const body = await readBody(request);
    const api = url.pathname.startsWith('/api/');
    try {
      const result = await handleAction(context, deps, url.pathname, body);
      if (api) {
        sendJson(
          response,
          200,
          result ? { ok: true, issue: publicIssue(result) } : { ok: true },
        );
      } else redirect(response, '/');
    } catch (error) {
      sendError(request, response, error, api);
    }
    return;
  }
  sendJson(response, 404, { ok: false, error: 'Not found' });
}

async function handleAction(
  context: BoardContext,
  deps: BoardDeps,
  pathname: string,
  body: Record<string, string>,
): Promise<Issue | null> {
  const mutate = deps.mutate ?? mutateIssue;
  const expected = body.expected_updated_at || undefined;
  if (pathname === '/focus' || pathname === '/api/focus') {
    const focus = body.focus ?? '';
    await (deps.updateFocus ?? defaultUpdateFocus)(context.anchorRoot, focus);
    return null;
  }
  const match = /^\/(?:api\/)?issues\/([^/]+)\/(tier|close|reopen|confirm|link)$/.exec(pathname);
  if (!match) throw new OpenIssueError('未知操作', 'UNKNOWN_ACTION');
  const id = decodeURIComponent(match[1]!);
  const action = match[2]!;
  if (action === 'tier') {
    const tier = body.tier?.trim();
    if (tier !== 'auto' && tier !== 'high' && tier !== 'medium' && tier !== 'low') {
      throw new OpenIssueError('档位必须是 high、medium、low 或 auto', 'INVALID_TIER');
    }
    return mutate(
      context.productDir,
      context.product.id,
      id,
      (issue) => applyManualTier(issue, tier),
      expected ? { expectedUpdatedAt: expected } : {},
    );
  }
  if (action === 'close') {
    const reason = parseCloseReason(body.reason);
    return mutate(
      context.productDir,
      context.product.id,
      id,
      (issue) => applyClose(issue, reason, body.note),
      expected ? { expectedUpdatedAt: expected } : {},
    );
  }
  if (action === 'reopen') {
    return mutate(
      context.productDir,
      context.product.id,
      id,
      (issue) => applyReopen(issue),
      expected ? { expectedUpdatedAt: expected } : {},
    );
  }
  const issue = await findIssue(context.productDir, context.product.id, id);
  if (action === 'confirm') {
    return (deps.confirm ?? defaultConfirmDone)(
      context.productDir,
      context.product.id,
      context.anchorRoot,
      issue,
    );
  }
  const change = body.change?.trim();
  if (!change) throw new OpenIssueError('必须填写提案标识', 'CHANGE_ID_REQUIRED');
  return (deps.link ?? defaultLinkProposal)({
    anchorRoot: context.anchorRoot,
    productDir: context.productDir,
    productId: context.product.id,
    issue,
    changeId: change,
  });
}

function serializeState(
  data: BoardData,
  filters: BoardFilters,
  filtered: FilteredEvaluation,
): Record<string, unknown> {
  const groups: Record<string, unknown[]> = {};
  for (const key of ['high', 'medium', 'low', 'unassessed'] as const) {
    groups[key] = filtered.groups[key].map((item) => serializeItem(data, item));
  }
  return {
    product: data.product,
    focus: data.product.focus,
    focus_updated_at: data.product.focus_updated_at,
    filters,
    groups,
    closed: filtered.closed.map((issue) => ({
      ...publicIssue(issue),
      ...handoffFields(data.handoffs.get(issue.id)),
    })),
    conflicts: data.conflicts.map(({ filePath: _filePath, ...rest }) => rest),
  };
}

function serializeItem(data: BoardData, item: EvaluatedIssue): Record<string, unknown> {
  const board = data.handoffs.get(item.issue.id);
  return {
    ...publicIssue(item.issue),
    effective_tier: item.tier,
    reason: item.reason,
    basis: item.basis,
    manual: item.manual,
    stale: item.stale,
    dependency_floor: item.dependency_floor,
    invalid_dependency: item.invalid_dependency,
    blocked: item.blocked,
    ...(item.blocked_reason ? { blocked_reason: item.blocked_reason } : {}),
    ...(item.input_hash ? { input_hash: item.input_hash } : {}),
    ...(item.judged_at ? { judged_at: item.judged_at } : {}),
    ...(data.startContexts.has(item.issue.id)
      ? { start_context: data.startContexts.get(item.issue.id)! }
      : {}),
    ...handoffFields(board),
  };
}

function handoffFields(handoff: HandoffState | undefined): Record<string, unknown> {
  if (!handoff) {
    return {
      proposals: [],
      archived_pending: false,
      link_invalid: false,
      updated_since_proposal: false,
      interview_incomplete: false,
      interview_unknown: false,
      interview_change_ids: [],
    };
  }
  return {
    proposals: handoff.proposals,
    archived_pending: handoff.archived_pending,
    link_invalid: handoff.link_invalid,
    updated_since_proposal: handoff.updated_since_proposal,
    interview_incomplete: handoff.interview_incomplete,
    interview_unknown: handoff.interview_unknown,
    interview_change_ids: handoff.interview_change_ids,
    ...(handoff.resume_change_id ? { resume_change_id: handoff.resume_change_id } : {}),
  };
}

async function readBody(request: IncomingMessage): Promise<Record<string, string>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += buffer.length;
    if (size > 1_000_000) throw new OpenIssueError('请求体过大', 'BODY_TOO_LARGE');
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  const contentType = request.headers['content-type'] ?? '';
  if (contentType.includes('application/json')) {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (value !== undefined && value !== null) result[key] = String(value);
    }
    return result;
  }
  const result: Record<string, string> = {};
  for (const [key, value] of new URLSearchParams(raw)) result[key] = value;
  return result;
}

function sendHtml(response: ServerResponse, html: string, status = 200): void {
  response.writeHead(status, { 'content-type': 'text/html; charset=utf-8' });
  response.end(html);
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(value));
}

function redirect(response: ServerResponse, location: string): void {
  response.writeHead(303, { location });
  response.end();
}

function sendError(
  request: IncomingMessage,
  response: ServerResponse,
  error: unknown,
  api = (request.url ?? '').startsWith('/api/'),
): void {
  if (response.headersSent) {
    response.end();
    return;
  }
  const message = error instanceof Error ? error.message : String(error);
  const status =
    error instanceof OpenIssueError
      ? error.code === 'CONCURRENT_MODIFICATION'
        ? 409
        : error.code === 'ISSUE_NOT_FOUND'
          ? 404
          : 400
      : 500;
  if (api) {
    sendJson(response, status, { ok: false, error: message });
  } else {
    sendHtml(response, renderBoardError(message), status);
  }
}
