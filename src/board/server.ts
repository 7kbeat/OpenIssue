import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OpenIssueError } from '../core/errors.js';
import type { Issue, ProductManifest, Tier } from '../core/types.js';
import { buildAssistantRequest } from '../domain/assistant.js';
import { assertCanDepend } from '../domain/dependencies.js';
import { applyClose, applyReopen, parseCloseReason } from '../domain/lifecycle.js';
import { applyManualTier } from '../domain/manual.js';
import type { EvaluatedIssue } from '../domain/priority.js';
import type { BoardFilters, FilteredEvaluation } from '../domain/search.js';
import { filterEvaluation, parseFilters } from '../domain/search.js';
import {
  archiveChange as defaultArchiveChange,
  confirmDone as defaultConfirmDone,
  linkProposal as defaultLinkProposal,
  type HandoffState,
} from '../services/handoff.js';
import { applyAssistantResults } from '../services/priority.js';
import {
  findIssue,
  loadIssues,
  mutateIssue,
  publicIssue,
} from '../storage/issue.js';
import { updateFocus as defaultUpdateFocus } from '../storage/product.js';
import { loadBoardData, type BoardContext, type BoardData } from './data.js';
import { buildBoardSnapshot } from './snapshot.js';

const UI_ROOT = fileURLToPath(new URL('../../dist/board-ui/', import.meta.url));

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
  archive?: (anchorRoot: string, changeId: string) => Promise<void>;
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
  const api = url.pathname.startsWith('/api/');
  if (request.method === 'GET' && url.pathname === '/api/board/state') {
    const data = await loadBoardData(context);
    sendJson(response, 200, await buildBoardSnapshot(context, data));
    return;
  }
  if (request.method === 'GET' && url.pathname === '/api/board/prioritize/emit') {
    const data = await loadBoardData(context);
    sendJson(
      response,
      200,
      buildAssistantRequest(
        data.product,
        { focus: data.product.focus, facts: data.facts },
        data.evaluation,
      ),
    );
    return;
  }
  if (request.method === 'GET' && url.pathname === '/api/state') {
    const filters = parseFilters(url.searchParams);
    const data = await loadBoardData(context);
    const filtered = filterEvaluation(data.evaluation, filters, data.issues);
    sendJson(response, 200, serializeState(data, filters, filtered));
    return;
  }
  if (request.method === 'POST' && url.pathname === '/api/board/prioritize/apply') {
    const body = await readBody(request);
    try {
      const data = await loadBoardData(context);
      const raw = Array.isArray(body.results)
        ? { results: body.results }
        : Array.isArray(body.items)
          ? { results: body.items }
          : body;
      const result = await applyAssistantResults({
        raw,
        productDir: context.productDir,
        productId: context.product.id,
        context: { focus: data.product.focus, facts: data.facts },
        evaluation: data.evaluation,
      });
      const next = await loadBoardData(context);
      sendJson(response, 200, {
        result,
        snapshot: await buildBoardSnapshot(context, next),
      });
    } catch (error) {
      sendError(request, response, error, true);
    }
    return;
  }
  if (url.pathname.startsWith('/api/board/')) {
    const body = await readBody(request);
    try {
      await handleBoardAction(context, deps, request.method ?? 'GET', url.pathname, body);
      const data = await loadBoardData(context);
      sendJson(response, 200, await buildBoardSnapshot(context, data));
    } catch (error) {
      sendError(request, response, error, true);
    }
    return;
  }
  if (request.method === 'POST') {
    const body = await readBody(request);
    try {
      const result = await handleLegacyAction(context, deps, url.pathname, body);
      if (api) {
        sendJson(
          response,
          200,
          result ? { ok: true, issue: publicIssue(result) } : { ok: true },
        );
      } else {
        redirect(response, '/');
      }
    } catch (error) {
      sendError(request, response, error, api);
    }
    return;
  }
  if (request.method === 'GET' && !api) {
    await serveUi(url.pathname, response);
    return;
  }
  sendJson(response, 404, { ok: false, error: 'Not found' });
  return;
}

async function handleBoardAction(
  context: BoardContext,
  deps: BoardDeps,
  method: string,
  pathname: string,
  body: Record<string, unknown>,
): Promise<void> {
  if (pathname === '/api/board/focus' && (method === 'PUT' || method === 'POST')) {
    const text = textField(body, 'text') ?? textField(body, 'focus') ?? '';
    await (deps.updateFocus ?? defaultUpdateFocus)(context.anchorRoot, text);
    return;
  }
  const archiveMatch = /^\/api\/board\/openspec\/archive\/([^/]+)$/.exec(pathname);
  if (archiveMatch && method === 'POST') {
    const changeId = decodeURIComponent(archiveMatch[1]!);
    await (deps.archive ?? ((anchorRoot, id) => defaultArchiveChange({ anchorRoot, changeId: id })))(
      context.anchorRoot,
      changeId,
    );
    return;
  }
  const replaceMatch = /^\/api\/board\/issues\/([^/]+)\/dependencies\/replace$/.exec(pathname);
  if (replaceMatch && method === 'PUT') {
    const blockedId = decodeURIComponent(replaceMatch[1]!);
    const oldBlockerId = requiredText(body, 'oldBlockerId');
    const newBlockerId = requiredText(body, 'newBlockerId');
    const collection = await loadIssues(context.productDir, context.product.id);
    const blocked = collection.issues.find((issue) => issue.id === blockedId);
    if (!blocked) throw new OpenIssueError(`找不到需求 ${blockedId}`, 'ISSUE_NOT_FOUND');
    const hypothetical = collection.issues.map((issue) =>
      issue.id === blockedId
        ? {
            ...issue,
            blocked_by: issue.blocked_by.filter((id) => id !== oldBlockerId),
          }
        : issue,
    );
    assertCanDepend(hypothetical, newBlockerId, blockedId);
    const mutate = deps.mutate ?? mutateIssue;
    await mutate(context.productDir, context.product.id, blockedId, (issue) => {
      issue.blocked_by = issue.blocked_by.filter((id) => id !== oldBlockerId);
      if (!issue.blocked_by.includes(newBlockerId)) issue.blocked_by.push(newBlockerId);
    });
    return;
  }
  const dependencyMatch = /^\/api\/board\/issues\/([^/]+)\/dependencies$/.exec(pathname);
  if (dependencyMatch && (method === 'POST' || method === 'DELETE')) {
    const blockedId = decodeURIComponent(dependencyMatch[1]!);
    const blockerId = requiredText(body, 'blockerId');
    const collection = await loadIssues(context.productDir, context.product.id);
    if (!collection.issues.some((issue) => issue.id === blockerId)) {
      throw new OpenIssueError(`找不到需求 ${blockerId}`, 'ISSUE_NOT_FOUND');
    }
    if (!collection.issues.some((issue) => issue.id === blockedId)) {
      throw new OpenIssueError(`找不到需求 ${blockedId}`, 'ISSUE_NOT_FOUND');
    }
    if (method === 'POST') {
      assertCanDepend(collection.issues, blockerId, blockedId);
    }
    const mutate = deps.mutate ?? mutateIssue;
    await mutate(context.productDir, context.product.id, blockedId, (issue) => {
      if (method === 'POST') {
        if (!issue.blocked_by.includes(blockerId)) {
          issue.blocked_by = [...issue.blocked_by, blockerId];
        }
      } else {
        issue.blocked_by = issue.blocked_by.filter((id) => id !== blockerId);
      }
    });
    return;
  }
  const match = /^\/api\/board\/issues\/([^/]+)\/(tier|close|reopen|handoff\/link|handoff\/confirm-complete)$/.exec(
    pathname,
  );
  if (!match) throw new OpenIssueError('未知操作', 'UNKNOWN_ACTION');
  const id = decodeURIComponent(match[1]!);
  const action = match[2]!;
  const mutate = deps.mutate ?? mutateIssue;
  if (action === 'tier') {
    const manual = body.manual_tier;
    const tier = manualTier(manual);
    await mutate(context.productDir, context.product.id, id, (issue) =>
      applyManualTier(issue, tier),
    );
    return;
  }
  if (action === 'close') {
    const reason = parseCloseReason(
      textField(body, 'reason')?.replace('wont_do', 'wontdo') ?? undefined,
    );
    await mutate(context.productDir, context.product.id, id, (issue) =>
      applyClose(issue, reason, textField(body, 'note')),
    );
    return;
  }
  if (action === 'reopen') {
    await mutate(context.productDir, context.product.id, id, (issue) => applyReopen(issue));
    return;
  }
  const issue = await findIssue(context.productDir, context.product.id, id);
  if (action === 'handoff/confirm-complete') {
    await (deps.confirm ?? defaultConfirmDone)(
      context.productDir,
      context.product.id,
      context.anchorRoot,
      issue,
    );
    return;
  }
  const change =
    textField(body, 'changeId') ?? textField(body, 'change') ?? requiredText(body, 'changeId');
  await (deps.link ?? defaultLinkProposal)({
    anchorRoot: context.anchorRoot,
    productDir: context.productDir,
    productId: context.product.id,
    issue,
    changeId: change,
  });
}

async function handleLegacyAction(
  context: BoardContext,
  deps: BoardDeps,
  pathname: string,
  body: Record<string, unknown>,
): Promise<Issue | null> {
  const mutate = deps.mutate ?? mutateIssue;
  const expected = textField(body, 'expected_updated_at');
  if (pathname === '/focus' || pathname === '/api/focus') {
    const focus = textField(body, 'focus') ?? textField(body, 'text') ?? '';
    await (deps.updateFocus ?? defaultUpdateFocus)(context.anchorRoot, focus);
    return null;
  }
  const match = /^\/(?:api\/)?issues\/([^/]+)\/(tier|close|reopen|confirm|link)$/.exec(pathname);
  if (!match) throw new OpenIssueError('未知操作', 'UNKNOWN_ACTION');
  const id = decodeURIComponent(match[1]!);
  const action = match[2]!;
  if (action === 'tier') {
    const tier = manualTier(body.tier);
    return mutate(
      context.productDir,
      context.product.id,
      id,
      (issue) => applyManualTier(issue, tier),
      expected ? { expectedUpdatedAt: expected } : {},
    );
  }
  if (action === 'close') {
    const reason = parseCloseReason(textField(body, 'reason'));
    return mutate(
      context.productDir,
      context.product.id,
      id,
      (issue) => applyClose(issue, reason, textField(body, 'note')),
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
  const change = textField(body, 'change');
  if (!change) throw new OpenIssueError('必须填写提案标识', 'CHANGE_ID_REQUIRED');
  return (deps.link ?? defaultLinkProposal)({
    anchorRoot: context.anchorRoot,
    productDir: context.productDir,
    productId: context.product.id,
    issue,
    changeId: change,
  });
}

function manualTier(value: unknown): Tier | 'auto' {
  if (value === '高' || value === 'high') return 'high';
  if (value === '中' || value === 'medium') return 'medium';
  if (value === '低' || value === 'low') return 'low';
  if (value === null || value === undefined || value === '' || value === 'auto') return 'auto';
  throw new OpenIssueError('档位必须是 high、medium、low 或 auto', 'INVALID_TIER');
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
      interview_completed: false,
      interview_unknown: false,
      interview_change_ids: [],
      interview_completed_change_ids: [],
    };
  }
  return {
    proposals: handoff.proposals,
    archived_pending: handoff.archived_pending,
    link_invalid: handoff.link_invalid,
    updated_since_proposal: handoff.updated_since_proposal,
    interview_incomplete: handoff.interview_incomplete,
    interview_completed: handoff.interview_completed,
    interview_unknown: handoff.interview_unknown,
    interview_change_ids: handoff.interview_change_ids,
    interview_completed_change_ids: handoff.interview_completed_change_ids,
    ...(handoff.resume_change_id ? { resume_change_id: handoff.resume_change_id } : {}),
  };
}

async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
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
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
      return parsed as Record<string, unknown>;
    } catch {
      throw new OpenIssueError('请求体不是合法 JSON', 'INVALID_BODY');
    }
  }
  const result: Record<string, unknown> = {};
  for (const [key, value] of new URLSearchParams(raw)) result[key] = value;
  return result;
}

function textField(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  return typeof value === 'string' ? value : undefined;
}

function requiredText(body: Record<string, unknown>, key: string): string {
  const value = textField(body, key)?.trim();
  if (!value) throw new OpenIssueError(`缺少参数 ${key}`, 'MISSING_PARAMETER');
  return value;
}

async function serveUi(pathname: string, response: ServerResponse): Promise<void> {
  const index = await readFile(path.join(UI_ROOT, 'index.html'), 'utf8').catch(() => undefined);
  if (index === undefined) {
    sendHtml(
      response,
      '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>OpenIssue</title><body><h1>看板界面尚未构建</h1><p>请先在 OpenIssue 代码仓库运行 <code>pnpm build</code>。</p></body></html>',
    );
    return;
  }
  if (pathname === '/') {
    sendHtml(response, index);
    return;
  }
  const requested = path.resolve(UI_ROOT, `.${decodeURIComponent(pathname)}`);
  if (!requested.startsWith(UI_ROOT)) {
    sendJson(response, 404, { ok: false, error: 'Not found' });
    return;
  }
  const content = await readFile(requested).catch(() => undefined);
  if (content === undefined) {
    if (pathname.startsWith('/assets/')) {
      sendJson(response, 404, { ok: false, error: 'Not found' });
    } else {
      sendHtml(response, index);
    }
    return;
  }
  const extension = path.extname(requested).toLowerCase();
  const type =
    extension === '.js'
      ? 'text/javascript; charset=utf-8'
      : extension === '.css'
        ? 'text/css; charset=utf-8'
        : extension === '.svg'
          ? 'image/svg+xml'
          : extension === '.png'
            ? 'image/png'
            : extension === '.woff2'
              ? 'font/woff2'
              : 'application/octet-stream';
  response.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
  response.end(content);
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
    sendHtml(
      response,
      `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>OpenIssue · 操作失败</title><body style="font-family:system-ui;padding:32px"><h1>操作未能完成</h1><p>${escapeHtml(message)}</p><p><a href="/">返回看板</a></p></body></html>`,
      status,
    );
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
