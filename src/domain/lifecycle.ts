import { OpenIssueError } from '../core/errors.js';
import type { CloseReason, Issue } from '../core/types.js';

export function parseCloseReason(value: string | undefined): CloseReason {
  if (!value?.trim()) {
    throw new OpenIssueError(
      '必须选择关闭原因：completed（已完成）或 wontdo（不做）',
      'CLOSE_REASON_REQUIRED',
    );
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === 'completed' || value.trim() === '已完成') return 'completed';
  if (normalized === 'wontdo' || normalized === 'wont-do' || value.trim() === '不做') {
    return 'wontdo';
  }
  throw new OpenIssueError(
    '关闭原因必须是 completed（已完成）或 wontdo（不做）',
    'INVALID_CLOSE_REASON',
  );
}

export function applyClose(
  issue: Issue,
  reason: CloseReason,
  note?: string,
  now = new Date().toISOString(),
): void {
  const normalizedNote = note?.trim() ?? '';
  if (reason === 'wontdo' && !normalizedNote) {
    throw new OpenIssueError('关闭原因为不做时原因必填', 'CLOSE_NOTE_REQUIRED');
  }
  issue.status = 'closed';
  issue.close = {
    reason,
    ...(normalizedNote ? { note: normalizedNote } : {}),
    closed_at: now,
  };
}

export function applyReopen(issue: Issue): void {
  if (issue.status === 'open') {
    throw new OpenIssueError('需求已经是打开状态', 'ALREADY_OPEN');
  }
  issue.status = 'open';
}
