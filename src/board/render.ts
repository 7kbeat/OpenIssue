import type { Issue } from '../core/types.js';
import type { EvaluatedIssue } from '../domain/priority.js';
import { tierLabel } from '../domain/priority.js';
import type { BoardFilters, FilteredEvaluation } from '../domain/search.js';
import type { BoardData, BoardItem } from './data.js';
import { boardItem } from './data.js';

export function renderBoardPage(
  data: BoardData,
  filters: BoardFilters,
  filtered: FilteredEvaluation,
): string {
  const counts = {
    high: filtered.groups.high.length,
    medium: filtered.groups.medium.length,
    low: filtered.groups.low.length,
    unassessed: filtered.groups.unassessed.length,
  };
  const totalOpen = counts.high + counts.medium + counts.low + counts.unassessed;
  const hasActiveFilters = Boolean(
    filters.q.trim() ||
      filters.status !== 'open' ||
      filters.tier ||
      filters.linked ||
      filters.blocked,
  );

  const groups = (['high', 'medium', 'low', 'unassessed'] as const)
    .map((tier) => renderGroup(tier, filtered.groups[tier], data, filters))
    .join('');

  const closed =
    filters.status === 'open'
      ? ''
      : `<details open class="group closed-group" data-testid="closed-section">
          <summary class="group-summary">
            <span class="group-title">已关闭</span>
            <span class="group-count">${filtered.closed.length}</span>
          </summary>
          <div class="group-body">
            ${
              filtered.closed.length === 0
                ? '<p class="empty-line">没有已关闭的需求</p>'
                : filtered.closed.map((issue) => renderClosed(issue, data)).join('')
            }
          </div>
        </details>`;

  const empty =
    totalOpen === 0 && filtered.closed.length === 0
      ? '<p class="empty-state" data-testid="empty-state">没有符合当前筛选条件的需求</p>'
      : '';

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>OpenIssue · ${escapeHtml(data.product.name)}</title>
<style>${CSS}</style>
</head>
<body>
<div class="shell">
  <header class="topbar">
    <div class="topbar-main">
      <div class="brand">
        <span class="brand-kicker">OpenIssue</span>
        <h1>${escapeHtml(data.product.name)}</h1>
      </div>
      <nav class="summary-nav" aria-label="优先级概览">
        <a href="#group-high">高 <span class="num">${counts.high}</span></a>
        <span class="sep" aria-hidden="true">/</span>
        <a href="#group-medium">中 <span class="num">${counts.medium}</span></a>
        <span class="sep" aria-hidden="true">/</span>
        <a href="#group-low">低 <span class="num">${counts.low}</span></a>
        <span class="sep" aria-hidden="true">/</span>
        <a href="#group-unassessed">待评估 <span class="num">${counts.unassessed}</span></a>
      </nav>
    </div>

    <form class="focus-bar" method="post" action="/focus" data-testid="focus-form">
      <label class="focus-label" for="focus">当前重点</label>
      <input id="focus" name="focus" value="${escapeHtml(data.product.focus)}" placeholder="用一句话写明当前产品最优先的目标" data-testid="focus-input">
      <button type="submit" class="btn-subtle" data-testid="focus-save">保存重点</button>
      <span class="focus-time" title="${escapeHtml(data.product.focus_updated_at ?? '')}">${
        data.product.focus_updated_at
          ? `更新于 ${escapeHtml(formatDate(data.product.focus_updated_at))}`
          : '未设置'
      }</span>
    </form>

    <form class="toolbar" method="get" action="/" data-testid="filters">
      <input type="search" name="q" value="${escapeHtml(filters.q)}" placeholder="搜索标题或描述..." data-testid="search-input" aria-label="搜索标题或描述">
      <div class="toolbar-selects">
        ${select(
          'status',
          filters.status,
          [
            ['open', '打开'],
            ['closed', '仅关闭'],
            ['all', '全部状态'],
          ],
          '状态',
        )}
        ${select(
          'tier',
          filters.tier ?? '',
          [
            ['', '全部档位'],
            ['high', '高'],
            ['medium', '中'],
            ['low', '低'],
            ['unassessed', '待评估'],
          ],
          '档位',
        )}
        ${select(
          'linked',
          filters.linked ?? '',
          [
            ['', '全部提案'],
            ['yes', '已关联提案'],
            ['no', '未关联提案'],
          ],
          '关联',
        )}
        ${select(
          'blocked',
          filters.blocked ?? '',
          [
            ['', '全部依赖'],
            ['yes', '被阻塞'],
            ['no', '未被阻塞'],
          ],
          '阻塞',
        )}
      </div>
      <div class="toolbar-actions">
        <button type="submit" class="btn-primary">筛选</button>
        <a href="/" class="clear-link${hasActiveFilters ? ' active' : ''}" data-testid="clear-filters">清除筛选</a>
      </div>
    </form>
  </header>

  <main class="board-main">
    ${renderConflicts(data)}
    ${empty}
    ${groups}
    ${closed}
  </main>
</div>
</body>
</html>`;
}

export function renderBoardError(message: string): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>OpenIssue · 操作失败</title>
<style>${CSS}</style>
</head>
<body>
<div class="shell">
  <main class="error-page">
    <h1>操作未能完成</h1>
    <p class="error-message" data-testid="board-error">${escapeHtml(message)}</p>
    <p><a class="btn-subtle link-btn" href="/">返回看板</a></p>
  </main>
</div>
</body>
</html>`;
}

function renderGroup(
  tier: 'high' | 'medium' | 'low' | 'unassessed',
  items: EvaluatedIssue[],
  data: BoardData,
  filters: BoardFilters,
): string {
  return `<details open id="group-${tier}" class="group group-${tier}" data-testid="group-${tier}">
    <summary class="group-summary">
      <span class="group-title">${tierLabel(tier)}</span>
      <span class="group-count">${items.length}</span>
    </summary>
    <div class="group-body">
      ${
        items.length === 0
          ? '<p class="empty-line">当前档位暂无需求</p>'
          : items.map((item) => renderCard(boardItem(data, item), data, filters)).join('')
      }
    </div>
  </details>`;
}

function renderCard(item: BoardItem, _data: BoardData, filters: BoardFilters): string {
  const issue = item.evaluated.issue;
  const handoff = item.handoff;

  const flags = [
    item.evaluated.manual
      ? '<span class="flag flag-accent" data-testid="manual-badge">手动</span>'
      : '',
    item.evaluated.stale
      ? '<span class="flag flag-warn" data-testid="stale-badge">待刷新</span>'
      : '',
    item.evaluated.dependency_floor
      ? '<span class="flag flag-info" data-testid="floor-badge">依赖下限</span>'
      : '',
    item.evaluated.blocked
      ? '<span class="flag flag-danger" data-testid="blocked-badge">被阻塞</span>'
      : '',
    handoff?.interview_incomplete
      ? '<span class="flag flag-warn" data-testid="interview-badge">访谈未完成</span>'
      : '',
    handoff?.interview_unknown
      ? '<span class="flag flag-warn" data-testid="interview-unknown-badge">访谈状态未知</span>'
      : '',
  ]
    .filter(Boolean)
    .join('<span class="dot" aria-hidden="true">·</span>');

  const proposals = issue.proposals
    .map((proposal) => {
      const state = handoff?.proposals.find((entry) => entry.id === proposal.id)?.state;
      const label =
        state === 'active'
          ? '在途'
          : state === 'archived'
            ? '已归档'
            : state === 'missing'
              ? '失效'
              : '未知';
      return `<li data-testid="proposal-item" data-proposal-state="${state ?? 'unknown'}"><span class="mono">${escapeHtml(proposal.id)}</span> <span class="muted">（${label}）</span></li>`;
    })
    .join('');

  const waiting =
    item.waiting.length > 0
      ? `<p data-testid="issue-waiting"><span class="dep-key">等待前置</span> ${item.waiting.map((id) => `<span class="mono">${escapeHtml(id)}</span>`).join('、')}</p>`
      : '';
  const blocking =
    item.blocking.length > 0
      ? `<p data-testid="issue-blocking"><span class="dep-key">阻塞下游</span> ${item.blocking.map((id) => `<span class="mono">${escapeHtml(id)}</span>`).join('、')}</p>`
      : '';
  const fallbackBlockedReason =
    item.evaluated.blocked_reason && item.waiting.length === 0
      ? `<p data-testid="blocked-reason">${escapeHtml(item.evaluated.blocked_reason)}</p>`
      : '';
  const depsBlock =
    waiting || blocking || fallbackBlockedReason
      ? `<div class="deps">${waiting}${blocking}${fallbackBlockedReason}</div>`
      : '';

  const archivedPrompt = handoff?.archived_pending
    ? `<div class="notice notice-ok" data-testid="archived-prompt">
        <span>关联提案已归档，请确认需求是否完成</span>
        <form method="post" action="/issues/${encodeURIComponent(issue.id)}/confirm">
          <button type="submit" class="btn-primary" data-testid="confirm-button">确认完成</button>
        </form>
      </div>`
    : '';

  const invalidLink = handoff?.link_invalid
    ? `<div class="notice notice-danger" data-testid="invalid-link-badge">
        <span>关联提案失效（未在活跃变更或归档目录中找到）</span>
        <form method="post" action="/issues/${encodeURIComponent(issue.id)}/link" class="inline-form">
          <input name="change" placeholder="输入新提案标识" aria-label="提案标识">
          <button type="submit" class="btn-subtle" data-testid="relink-button">重新关联</button>
        </form>
      </div>`
    : '';

  const snapshotUpdated = handoff?.updated_since_proposal
    ? '<div class="notice notice-warn" data-testid="snapshot-updated">需求正文在关联提案后有更新，建议核对后再归档</div>'
    : '';

  const startEntry = item.start
    ? `<details class="inline-details" data-testid="start-entry">
        <summary>OpenSpec 访谈入口</summary>
        <div class="details-panel">
          <p class="details-hint">将以下上下文交给 Agent 继续产品决策访谈：</p>
          ${
            item.start.skill_available
              ? ''
              : '<p class="notice notice-danger" data-testid="interview-skill-missing">当前仓库未安装 openissue-grill-me，请先运行 <code>openissue skills install --tool agents</code>。</p>'
          }
          <pre data-testid="start-context">${escapeHtml(item.start.instruction)}</pre>
        </div>
      </details>`
    : '';

  const description = issue.description
    ? `<p class="description" data-testid="issue-description">${highlight(issue.description, filters.q)}</p>`
    : '';

  return `<article class="issue-row" data-testid="issue-card" data-issue-id="${escapeHtml(issue.id)}" data-tier="${item.evaluated.tier}">
    <div class="issue-kicker">
      <span class="issue-id mono" data-testid="issue-id">${escapeHtml(issue.id)}</span>
      <span class="dot" aria-hidden="true">·</span>
      <span class="issue-tier tier-${item.evaluated.tier}" data-testid="issue-tier">${tierLabel(item.evaluated.tier)}</span>
      <span class="dot" aria-hidden="true">·</span>
      <span class="issue-status" data-testid="issue-status">${statusLabel(issue)}</span>
      ${flags ? `<span class="dot" aria-hidden="true">·</span>${flags}` : ''}
    </div>

    <div class="issue-core">
      <h3 class="issue-title" data-testid="issue-title">${highlight(issue.title, filters.q)}</h3>
      ${description}
      <p class="issue-reason" data-testid="issue-reason"><span class="reason-label">判断依据</span> ${escapeHtml(item.evaluated.reason)}</p>
      ${depsBlock}
      ${proposals ? `<ul class="proposals" data-testid="issue-proposals">${proposals}</ul>` : ''}
      ${archivedPrompt}${invalidLink}${snapshotUpdated}
    </div>

    <footer class="issue-foot">
      <div class="issue-foot-left">
        <span class="meta" data-testid="issue-meta" title="创建 ${escapeHtml(issue.created_at)} · 更新 ${escapeHtml(issue.updated_at)}">作者 ${escapeHtml(issue.author)} · 创建 ${escapeHtml(formatDate(issue.created_at))} · 更新 ${escapeHtml(formatDate(issue.updated_at))}</span>
        ${startEntry}
      </div>

      <div class="issue-actions">
        <form method="post" action="/issues/${encodeURIComponent(issue.id)}/tier" class="inline-form">
          <input type="hidden" name="expected_updated_at" value="${escapeHtml(issue.updated_at)}">
          <select name="tier" data-testid="tier-select" aria-label="档位">
            ${option('auto', '自动档位', (issue.priority.manual_tier ?? 'auto') === 'auto')}
            ${option('high', '高优先级', issue.priority.manual_tier === 'high')}
            ${option('medium', '中优先级', issue.priority.manual_tier === 'medium')}
            ${option('low', '低优先级', issue.priority.manual_tier === 'low')}
          </select>
          <button type="submit" class="btn-subtle" data-testid="tier-save">保存档位</button>
        </form>
        <form method="post" action="/issues/${encodeURIComponent(issue.id)}/close" class="inline-form close-form">
          <input type="hidden" name="expected_updated_at" value="${escapeHtml(issue.updated_at)}">
          <select name="reason" data-testid="close-reason" aria-label="关闭原因">
            <option value="completed">已完成</option>
            <option value="wontdo">不做</option>
          </select>
          <input name="note" class="close-note-input" placeholder="不做时填原因" data-testid="close-note" aria-label="关闭说明">
          <button type="submit" class="btn-ghost" data-testid="close-button">关闭</button>
        </form>
      </div>
    </footer>
  </article>`;
}

function renderClosed(issue: Issue, data: BoardData): string {
  const close = issue.close;
  const handoff = data.handoffs.get(issue.id);
  return `<article class="issue-row closed-row" data-testid="closed-issue" data-issue-id="${escapeHtml(issue.id)}">
    <div class="issue-kicker">
      <span class="issue-id mono" data-testid="issue-id">${escapeHtml(issue.id)}</span>
      <span class="dot" aria-hidden="true">·</span>
      <span class="issue-status" data-testid="issue-status">关闭 · ${close ? closeLabel(close.reason) : '未知原因'}</span>
    </div>
    <div class="issue-core">
      <h3 class="issue-title" data-testid="issue-title">${escapeHtml(issue.title)}</h3>
      ${close?.note ? `<p class="issue-reason" data-testid="close-note-display"><span class="reason-label">关闭说明</span> ${escapeHtml(close.note)}</p>` : ''}
      ${handoff?.link_invalid ? '<div class="notice notice-danger" data-testid="invalid-link-badge">关联提案失效</div>' : ''}
    </div>
    <footer class="issue-foot">
      <span class="meta" data-testid="issue-meta">作者 ${escapeHtml(issue.author)} · 更新 ${escapeHtml(formatDate(issue.updated_at))}</span>
      <form method="post" action="/issues/${encodeURIComponent(issue.id)}/reopen" class="inline-form">
        <input type="hidden" name="expected_updated_at" value="${escapeHtml(issue.updated_at)}">
        <button type="submit" class="btn-subtle" data-testid="reopen-button">重新打开</button>
      </form>
    </footer>
  </article>`;
}

function renderConflicts(data: BoardData): string {
  if (data.conflicts.length === 0) return '';
  return `<details open class="conflicts" data-testid="conflicts">
    <summary class="conflicts-summary">需要处理的冲突记录 <span class="group-count">${data.conflicts.length}</span></summary>
    <div class="conflicts-list">
      ${data.conflicts
        .map(
          (conflict) => `<article class="conflict-item" data-testid="conflict-item">
        <p class="conflict-title"><span class="mono">${escapeHtml(conflict.relativePath)}</span> · ${escapeHtml(conflict.error)}</p>
        <pre data-testid="conflict-raw">${escapeHtml(conflict.raw)}</pre>
      </article>`,
        )
        .join('')}
    </div>
  </details>`;
}

function select(
  name: string,
  value: string,
  options: Array<[string, string]>,
  label: string,
): string {
  return `<select name="${name}" data-testid="${name}-filter" aria-label="${label}">
    ${options.map(([optionValue, text]) => option(optionValue, text, value === optionValue)).join('')}
  </select>`;
}

function option(value: string, text: string, selected: boolean): string {
  return `<option value="${escapeHtml(value)}"${selected ? ' selected' : ''}>${escapeHtml(text)}</option>`;
}

function statusLabel(issue: Issue): string {
  if (issue.status === 'open') return '打开';
  return `关闭 · ${issue.close ? closeLabel(issue.close.reason) : '未知原因'}`;
}

function closeLabel(reason: 'completed' | 'wontdo'): string {
  return reason === 'completed' ? '已完成' : '不做';
}

function formatDate(iso: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(iso);
  if (match) return `${match[1]} ${match[2]}`;
  return iso;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function highlight(value: string, query: string): string {
  const escaped = escapeHtml(value);
  if (!query.trim()) return escaped;
  const escapedQuery = escapeRegExp(escapeHtml(query.trim()));
  return escaped.replace(new RegExp(`(${escapedQuery})`, 'gi'), '<mark>$1</mark>');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const CSS = `
:root {
  color-scheme: light;
  --bg: #f8fafc;
  --surface: #ffffff;
  --surface-muted: #f1f5f9;
  --border: #e2e8f0;
  --border-strong: #cbd5e1;
  --ink: #0f172a;
  --ink-secondary: #334155;
  --ink-muted: #64748b;
  --accent: #0f172a;
  --focus-ring: #2563eb;
  --danger: #b91c1c;
  --danger-bg: #fef2f2;
  --danger-border: #fecaca;
  --warn: #b45309;
  --warn-bg: #fffbeb;
  --warn-border: #fde68a;
  --ok: #15803d;
  --ok-bg: #f0fdf4;
  --ok-border: #bbf7d0;
  --info: #1d4ed8;
  font-family: "Plus Jakarta Sans", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, -apple-system, sans-serif;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  background: var(--bg);
  color: var(--ink);
  font-size: 14px;
  line-height: 1.55;
  -webkit-font-smoothing: antialiased;
}

.shell {
  max-width: 1080px;
  margin: 0 auto;
  padding: 24px 24px 72px;
}

.mono {
  font-family: ui-monospace, "JetBrains Mono", "IBM Plex Mono", SFMono-Regular, Menlo, Consolas, monospace;
  font-variant-numeric: tabular-nums;
}

.num { font-variant-numeric: tabular-nums; }
.muted { color: var(--ink-muted); }
.dot { color: var(--border-strong); user-select: none; }

/* Header & Compact Workspace Controls */
.topbar {
  border-bottom: 1px solid var(--border);
  padding-bottom: 16px;
  margin-bottom: 24px;
}

.topbar-main {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 24px;
  flex-wrap: wrap;
}

.brand {
  display: flex;
  align-items: baseline;
  gap: 10px;
}

.brand-kicker {
  font-size: 12px;
  font-weight: 600;
  color: var(--ink-muted);
  letter-spacing: 0.04em;
}

h1 {
  margin: 0;
  font-size: 22px;
  font-weight: 650;
  letter-spacing: -0.015em;
  color: var(--ink);
}

.summary-nav {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  color: var(--ink-muted);
  white-space: nowrap;
}

.summary-nav a {
  color: var(--ink-secondary);
  text-decoration: none;
  font-weight: 500;
}

.summary-nav a:hover {
  color: var(--ink);
  text-decoration: underline;
  text-underline-offset: 3px;
}

.summary-nav .sep { color: var(--border-strong); }

.focus-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 14px;
  padding: 8px 12px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 6px;
  flex-wrap: wrap;
}

.focus-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--ink-muted);
  white-space: nowrap;
}

.focus-bar input {
  flex: 1 1 280px;
  min-width: 180px;
  border: 1px solid transparent;
  background: transparent;
  padding: 4px 6px;
  font-size: 13.5px;
  color: var(--ink);
  border-radius: 4px;
}

.focus-bar input:hover {
  background: var(--surface-muted);
}

.focus-bar input:focus {
  background: var(--surface);
  border-color: var(--border-strong);
}

.focus-time {
  font-size: 12px;
  color: var(--ink-muted);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
  flex-wrap: wrap;
}

.toolbar input[type="search"] {
  flex: 1 1 220px;
  min-width: 180px;
}

.toolbar-selects {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.toolbar-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

input, select, button {
  font: inherit;
  font-size: 13px;
  line-height: 1.3;
  border: 1px solid var(--border-strong);
  border-radius: 5px;
  background: var(--surface);
  color: var(--ink);
  padding: 6px 10px;
  transition: border-color 140ms ease, background-color 140ms ease, color 140ms ease;
}

input:focus-visible, select:focus-visible, button:focus-visible, summary:focus-visible, a:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 2px;
}

button {
  cursor: pointer;
  font-weight: 500;
  white-space: nowrap;
}

.btn-primary {
  background: var(--accent);
  border-color: var(--accent);
  color: #ffffff;
  padding: 6px 14px;
}

.btn-primary:hover { background: #1e293b; border-color: #1e293b; }

.btn-subtle {
  background: var(--surface);
  border-color: var(--border-strong);
  color: var(--ink-secondary);
  padding: 5px 10px;
}

.btn-subtle:hover { background: var(--surface-muted); color: var(--ink); }

.btn-ghost {
  background: transparent;
  border-color: var(--border);
  color: var(--ink-muted);
  padding: 5px 10px;
}

.btn-ghost:hover {
  background: var(--surface-muted);
  border-color: var(--border-strong);
  color: var(--ink);
}

.clear-link {
  font-size: 12.5px;
  color: var(--ink-muted);
  text-decoration: none;
  padding: 4px 6px;
  white-space: nowrap;
}

.clear-link.active { color: var(--info); font-weight: 500; }
.clear-link:hover { color: var(--ink); text-decoration: underline; }

/* Collapsible Priority Groups */
.group {
  margin-bottom: 20px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 6px;
}

.group-summary {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  cursor: pointer;
  list-style: none;
  user-select: none;
  font-size: 13.5px;
  font-weight: 600;
  color: var(--ink);
  border-bottom: 1px solid transparent;
}

.group-summary::-webkit-details-marker { display: none; }

.group-summary::before {
  content: "▸";
  font-size: 11px;
  color: var(--ink-muted);
  transition: transform 140ms ease;
}

.group[open] > .group-summary {
  border-bottom-color: var(--border);
}

.group[open] > .group-summary::before {
  transform: rotate(90deg);
}

.group-count {
  font-size: 12px;
  font-weight: 500;
  color: var(--ink-muted);
  font-variant-numeric: tabular-nums;
}

.group-high .group-title { color: var(--danger); }
.group-medium .group-title { color: var(--warn); }
.group-low .group-title { color: var(--ink-secondary); }
.group-unassessed .group-title { color: var(--ink-muted); }

.empty-line {
  margin: 0;
  padding: 12px 16px;
  font-size: 13px;
  color: var(--ink-muted);
}

.empty-state {
  margin: 24px 0;
  padding: 28px 20px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--ink-muted);
  text-align: center;
}

/* Issue Row: Content-First Hierarchy */
.issue-row {
  padding: 16px 18px;
  border-bottom: 1px solid var(--border);
}

.issue-row:last-child { border-bottom: none; }

.issue-kicker {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--ink-muted);
  margin-bottom: 6px;
}

.issue-tier { font-weight: 600; }
.tier-high { color: var(--danger); }
.tier-medium { color: var(--warn); }
.tier-low { color: var(--ink-secondary); }
.tier-unassessed { color: var(--ink-muted); }

.flag { font-weight: 500; }
.flag-accent { color: var(--info); }
.flag-warn { color: var(--warn); }
.flag-info { color: var(--ok); }
.flag-danger { color: var(--danger); }

.issue-core {
  max-width: 78ch;
}

.issue-title {
  margin: 0 0 6px;
  font-size: 16px;
  font-weight: 600;
  line-height: 1.4;
  color: var(--ink);
  text-wrap: balance;
}

.description {
  margin: 0 0 8px;
  font-size: 14px;
  line-height: 1.6;
  color: var(--ink-secondary);
  white-space: pre-wrap;
}

.issue-reason {
  margin: 0 0 6px;
  font-size: 13px;
  color: var(--ink-secondary);
}

.reason-label, .dep-key {
  font-weight: 600;
  color: var(--ink-muted);
  margin-right: 4px;
}

.deps {
  margin: 6px 0 4px;
  font-size: 12.5px;
  color: var(--ink-secondary);
}

.deps p { margin: 2px 0; }

.proposals {
  margin: 6px 0 4px;
  padding-left: 16px;
  font-size: 12.5px;
  color: var(--ink-secondary);
}

.proposals li { margin: 2px 0; }

/* Notices */
.notice {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 8px;
  padding: 8px 12px;
  border-radius: 5px;
  border: 1px solid var(--border);
  font-size: 12.5px;
}

.notice-ok { background: var(--ok-bg); border-color: var(--ok-border); color: var(--ok); }
.notice-warn { background: var(--warn-bg); border-color: var(--warn-border); color: var(--warn); }
.notice-danger { background: var(--danger-bg); border-color: var(--danger-border); color: var(--danger); }

/* Quiet Footer & Collapsible Secondary Details */
.issue-foot {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: flex-start;
  gap: 10px 16px;
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid #f1f5f9;
}

.issue-foot-left {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.meta {
  font-size: 12px;
  color: var(--ink-muted);
  font-variant-numeric: tabular-nums;
}

.inline-details summary {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  font-size: 12px;
  font-weight: 500;
  color: var(--ink-secondary);
  list-style: none;
}

.inline-details summary::-webkit-details-marker { display: none; }
.inline-details summary::before { content: "▸"; font-size: 10px; color: var(--ink-muted); }
.inline-details[open] summary::before { content: "▾"; }
.inline-details summary:hover { color: var(--ink); }

.details-panel {
  margin-top: 8px;
  padding: 10px 12px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 5px;
}

.details-hint {
  margin: 0 0 6px;
  font-size: 12px;
  color: var(--ink-muted);
}

.details-panel pre {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: 12px;
  line-height: 1.5;
  color: var(--ink);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

.issue-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.inline-form {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.issue-actions select,
.issue-actions input,
.issue-actions button {
  font-size: 12px;
  padding: 4px 8px;
  border-color: var(--border);
}

.close-note-input {
  width: 96px;
  transition: width 140ms ease, border-color 140ms ease;
}

.close-note-input:focus,
.close-form:has(select[name="reason"] option[value="wontdo"]:checked) .close-note-input {
  width: 168px;
  border-color: var(--border-strong);
}

/* Conflicts */
.conflicts {
  margin-bottom: 20px;
  background: var(--danger-bg);
  border: 1px solid var(--danger-border);
  border-radius: 6px;
}

.conflicts-summary {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  cursor: pointer;
  font-size: 13.5px;
  font-weight: 600;
  color: var(--danger);
  list-style: none;
}

.conflicts-summary::-webkit-details-marker { display: none; }

.conflicts-list {
  padding: 0 16px 14px;
}

.conflict-item {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--danger-border);
}

.conflict-title {
  margin: 0 0 6px;
  font-size: 13px;
  color: var(--danger);
}

.conflict-item pre {
  margin: 0;
  padding: 8px 10px;
  background: var(--surface);
  border: 1px solid var(--danger-border);
  border-radius: 4px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: 12px;
}

/* Error page */
.error-page {
  margin-top: 32px;
  padding: 24px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 6px;
}

.error-message { color: var(--danger); }
.link-btn { display: inline-block; text-decoration: none; }

mark {
  background: #fef08a;
  color: inherit;
  padding: 0 2px;
  border-radius: 2px;
}

@media (max-width: 760px) {
  .shell { padding: 16px 16px 56px; }
  .issue-foot { flex-direction: column; align-items: stretch; }
  .issue-actions { justify-content: flex-start; }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { transition: none !important; }
}
`;
