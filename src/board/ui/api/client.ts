import type {
  AssistantRequest,
  BoardSnapshot,
  CloseReason,
  PriorityTier,
  PrioritizeApplyResponse,
} from '../../types.js';

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    headers: { 'content-type': 'application/json' },
    ...options,
  });
  const payload: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    let message = `操作未完成，请稍后重试（状态码 ${response.status}）`;
    if (payload && typeof payload === 'object' && 'error' in payload) {
      const detail = payload.error;
      if (typeof detail === 'string' && detail.trim()) message = detail;
    }
    throw new Error(message);
  }
  return payload as T;
}

function stateMutation(url: string, method: string, body?: unknown): Promise<BoardSnapshot> {
  return request<BoardSnapshot>(url, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

export const api = {
  getState: () => request<BoardSnapshot>('/api/board/state'),
  updateFocus: (text: string) =>
    stateMutation('/api/board/focus', 'PUT', { text }),
  setManualTier: (id: string, manualTier: PriorityTier | null) =>
    stateMutation(`/api/board/issues/${encodeURIComponent(id)}/tier`, 'PUT', {
      manual_tier: manualTier,
    }),
  closeIssue: (id: string, reason: CloseReason | undefined, note?: string) =>
    stateMutation(`/api/board/issues/${encodeURIComponent(id)}/close`, 'POST', {
      reason,
      note,
    }),
  reopenIssue: (id: string) =>
    stateMutation(`/api/board/issues/${encodeURIComponent(id)}/reopen`, 'POST'),
  addDependency: (blockerId: string, blockedId: string) =>
    stateMutation(
      `/api/board/issues/${encodeURIComponent(blockedId)}/dependencies`,
      'POST',
      { blockerId, blockedId },
    ),
  removeDependency: (blockerId: string, blockedId: string) =>
    stateMutation(
      `/api/board/issues/${encodeURIComponent(blockedId)}/dependencies`,
      'DELETE',
      { blockerId, blockedId },
    ),
  replaceDependency: (blockedId: string, oldBlockerId: string, newBlockerId: string) =>
    stateMutation(
      `/api/board/issues/${encodeURIComponent(blockedId)}/dependencies/replace`,
      'PUT',
      { oldBlockerId, newBlockerId },
    ),
  linkProposal: (id: string, changeId: string) =>
    stateMutation(
      `/api/board/issues/${encodeURIComponent(id)}/handoff/link`,
      'POST',
      { changeId },
    ),
  confirmComplete: (id: string) =>
    stateMutation(
      `/api/board/issues/${encodeURIComponent(id)}/handoff/confirm-complete`,
      'POST',
    ),
  archiveChange: (changeId: string) =>
    stateMutation(
      `/api/board/openspec/archive/${encodeURIComponent(changeId)}`,
      'POST',
    ),
  emitPrioritize: () => request<AssistantRequest>('/api/board/prioritize/emit'),
  applyPrioritize: (items: unknown[]) =>
    request<PrioritizeApplyResponse>('/api/board/prioritize/apply', {
      method: 'POST',
      body: JSON.stringify({ results: items }),
    }),
};
