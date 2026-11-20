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
  const groups = (['high', 'medium', 'low', 'unassessed'] as const)
    .map((tier) => renderGroup(tier, filtered.groups[tier], data, filters))
    .join('');
  const closed =
    filters.status === 'open'
      ? ''
      : `<section class="group" data-testid="closed-section">
          <h2>已关闭</h2>
          ${filtered.closed.length === 0 ? '<p class="empty">没有已关闭的需求</p>' : filtered.closed.map((issue) => renderClosed(issue, data)).join('')}
        </section>`;
  const total = (['high', 'medium', 'low', 'unassessed'] as const).reduce(
    (sum, key) => sum + filtered.groups[key].length,
    0,
  );
  const empty =
    total === 0 && filtered.closed.length === 0
      ? '<p class="empty" data-testid="empty-state">没有符合条件的需求</p>'
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
<header>
  <div class="title-row">
    <div>
      <p class="eyebrow">OpenIssue</p>
      <h1>${escapeHtml(data.product.name)}</h1>
    </div>
    <p class="quiet">只绑定 127.0.0.1 · 单人使用 · 数据来自 Git 仓库</p>
  </div>
  <form class="filters" method="get" action="/" data-testid="filters">
    <input type="search" name="q" value="${escapeHtml(filters.q)}" placeholder="搜索标题或描述" data-testid="search-input" aria-label="搜索标题或描述">
    ${select('status', filters.status, [
      ['open', '打开'],
      ['closed', '仅关闭'],
      ['all', '全部'],
    ], '状态')}
    ${select('tier', filters.tier ?? '', [
      ['', '全部档位'],
      ['high', '高'],
      ['medium', '中'],
      ['low', '低'],
      ['unassessed', '待评估'],
    ], '档位')}
    ${select('linked', filters.linked ?? '', [
      ['', '全部关联'],
      ['yes', '已关联提案'],
      ['no', '未关联提案'],
    ], '关联')}
    ${select('blocked', filters.blocked ?? '', [
      ['', '全部阻塞状态'],
      ['yes', '被阻塞'],
      ['no', '未被阻塞'],
    ], '阻塞')}
    <button type="submit">筛选</button>
    <a href="/" data-testid="clear-filters">清除筛选</a>
  </form>
  <form class="focus" method="post" action="/focus" data-testid="focus-form">
    <label for="focus">当前重点</label>
    <input id="focus" name="focus" value="${escapeHtml(data.product.focus)}" placeholder="一句话说明当前最重要的事" data-testid="focus-input">
    <button type="submit" data-testid="focus-save">保存重点</button>
    <span class="quiet">${data.product.focus_updated_at ? `更新于 ${escapeHtml(data.product.focus_updated_at)}` : '尚未设置'}</span>
  </form>
</header>
<main>
  ${renderConflicts(data)}
  ${empty}
  ${groups}
  ${closed}
</main>
</body>
</html>`;
}

export function renderBoardError(message: string): string {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>OpenIssue · 操作失败</title><style>${CSS}</style></head>
<body><main><h1>操作失败</h1><p class="error" data-testid="board-error">${escapeHtml(message)}</p><p><a href="/">返回看板</a></p></main></body></html>`;
}

function renderGroup(
  tier: 'high' | 'medium' | 'low' | 'unassessed',
  items: EvaluatedIssue[],
  data: BoardData,
  filters: BoardFilters,
): string {
  return `<section class="group" data-testid="group-${tier}">
    <h2>${tierLabel(tier)} <span class="count">${items.length}</span></h2>
    ${items.length === 0 ? '<p class="empty">（无）</p>' : items.map((item) => renderCard(boardItem(data, item), data, filters)).join('')}
  </section>`;
}

function renderCard(item: BoardItem, data: BoardData, filters: BoardFilters): string {
  const issue = item.evaluated.issue;
  const handoff = item.handoff;
  const proposals = issue.proposals
    .map((proposal) => {
      const state = handoff?.proposals.find((item) => item.id === proposal.id)?.state;
      const label = state === 'active' ? '在途' : state === 'archived' ? '已归档' : state === 'missing' ? '失效' : '未知';
      return `<li data-testid="proposal-item" data-proposal-state="${state ?? 'unknown'}">${escapeHtml(proposal.id)} <span class="quiet">（${label}）</span></li>`;
    })
    .join('');
  const waiting = item.waiting.length > 0
    ? `<p data-testid="issue-waiting">等待：${item.waiting.map(escapeHtml).join('、')}</p>`
    : '';
  const blocking = item.blocking.length > 0
    ? `<p data-testid="issue-blocking">阻塞：${item.blocking.map(escapeHtml).join('、')}</p>`
    : '';
  const badges = [
    item.evaluated.manual ? '<span class="badge manual" data-testid="manual-badge">手动</span>' : '',
    item.evaluated.stale ? '<span class="badge stale" data-testid="stale-badge">待刷新</span>' : '',
    item.evaluated.dependency_floor ? '<span class="badge floor" data-testid="floor-badge">依赖下限</span>' : '',
    item.evaluated.blocked ? '<span class="badge blocked" data-testid="blocked-badge">被阻塞</span>' : '',
    handoff?.interview_incomplete
      ? '<span class="badge interview" data-testid="interview-badge">访谈未完成</span>'
      : '',
    handoff?.interview_unknown
      ? '<span class="badge interview" data-testid="interview-unknown-badge">访谈状态未知</span>'
      : '',
  ].join('');
  const archivedPrompt = handoff?.archived_pending
    ? `<div class="notice" data-testid="archived-prompt">提案已归档，待确认完成
        <form method="post" action="/issues/${encodeURIComponent(issue.id)}/confirm"><button type="submit" data-testid="confirm-button">确认完成</button></form>
      </div>`
    : '';
  const invalidLink = handoff?.link_invalid
    ? `<div class="notice danger" data-testid="invalid-link-badge">关联失效
        <form method="post" action="/issues/${encodeURIComponent(issue.id)}/link" class="inline-form">
          <input name="change" placeholder="提案标识" aria-label="提案标识">
          <button type="submit" data-testid="relink-button">重新关联</button>
        </form>
      </div>`
    : '';
  const snapshotUpdated = handoff?.updated_since_proposal
    ? '<div class="notice" data-testid="snapshot-updated">创建提案后有更新</div>'
    : '';
  const startEntry = item.start
    ? `<details class="start-entry" data-testid="start-entry">
        <summary>开始 OpenSpec</summary>
        <p>访谈在 Agent 对话中继续。复制下面的上下文交给 Agent：</p>
        ${item.start.skill_available ? '' : '<p class="notice danger" data-testid="interview-skill-missing">当前仓库未安装 openissue-grill-me。先运行 <code>openissue skills install --tool agents</code>。</p>'}
        <pre data-testid="start-context">${escapeHtml(item.start.instruction)}</pre>
      </details>`
    : '';
  const description = issue.description
    ? `<p class="description" data-testid="issue-description">${highlight(issue.description, filters.q)}</p>`
    : '';
  return `<article class="card" data-testid="issue-card" data-issue-id="${escapeHtml(issue.id)}" data-tier="${item.evaluated.tier}">
    <div class="card-head">
      <span class="id" data-testid="issue-id">${escapeHtml(issue.id)}</span>
      <span class="tier" data-testid="issue-tier">${tierLabel(item.evaluated.tier)}</span>
      <span class="status" data-testid="issue-status">${statusLabel(issue)}</span>
      ${badges}
    </div>
    <h3 data-testid="issue-title">${highlight(issue.title, filters.q)}</h3>
    <p class="reason" data-testid="issue-reason">理由：${escapeHtml(item.evaluated.reason)}</p>
    ${description}
    <div class="deps">${waiting}${blocking}${item.evaluated.blocked_reason && item.waiting.length === 0 ? `<p data-testid="blocked-reason">${escapeHtml(item.evaluated.blocked_reason)}</p>` : ''}</div>
    ${proposals ? `<ul class="proposals" data-testid="issue-proposals">${proposals}</ul>` : ''}
    ${archivedPrompt}${invalidLink}${snapshotUpdated}${startEntry}
    <p class="meta" data-testid="issue-meta">作者 ${escapeHtml(issue.author)} · 创建 ${escapeHtml(issue.created_at)} · 更新 ${escapeHtml(issue.updated_at)}</p>
    <div class="actions">
      <form method="post" action="/issues/${encodeURIComponent(issue.id)}/tier" class="inline-form">
        <input type="hidden" name="expected_updated_at" value="${escapeHtml(issue.updated_at)}">
        <select name="tier" data-testid="tier-select" aria-label="档位">
          ${option('auto', '自动', (issue.priority.manual_tier ?? 'auto') === 'auto')}
          ${option('high', '高', issue.priority.manual_tier === 'high')}
          ${option('medium', '中', issue.priority.manual_tier === 'medium')}
          ${option('low', '低', issue.priority.manual_tier === 'low')}
        </select>
        <button type="submit" data-testid="tier-save">保存档位</button>
      </form>
      <form method="post" action="/issues/${encodeURIComponent(issue.id)}/close" class="inline-form">
        <input type="hidden" name="expected_updated_at" value="${escapeHtml(issue.updated_at)}">
        <select name="reason" data-testid="close-reason" aria-label="关闭原因">
          <option value="completed">已完成</option>
          <option value="wontdo">不做</option>
        </select>
        <input name="note" placeholder="不做时填写原因" data-testid="close-note" aria-label="关闭说明">
        <button type="submit" data-testid="close-button">关闭</button>
      </form>
    </div>
  </article>`;
}

function renderClosed(issue: Issue, data: BoardData): string {
  const close = issue.close;
  const handoff = data.handoffs.get(issue.id);
  return `<article class="card closed" data-testid="closed-issue" data-issue-id="${escapeHtml(issue.id)}">
    <div class="card-head">
      <span class="id" data-testid="issue-id">${escapeHtml(issue.id)}</span>
      <span class="status" data-testid="issue-status">关闭 · ${close ? closeLabel(close.reason) : '未知原因'}</span>
    </div>
    <h3 data-testid="issue-title">${escapeHtml(issue.title)}</h3>
    ${close?.note ? `<p class="reason" data-testid="close-note-display">原因：${escapeHtml(close.note)}</p>` : ''}
    ${handoff?.link_invalid ? '<div class="notice danger" data-testid="invalid-link-badge">关联失效</div>' : ''}
    <p class="meta" data-testid="issue-meta">作者 ${escapeHtml(issue.author)} · 更新 ${escapeHtml(issue.updated_at)}</p>
    <form method="post" action="/issues/${encodeURIComponent(issue.id)}/reopen" class="inline-form">
      <input type="hidden" name="expected_updated_at" value="${escapeHtml(issue.updated_at)}">
      <button type="submit" data-testid="reopen-button">重新打开</button>
    </form>
  </article>`;
}

function renderConflicts(data: BoardData): string {
  if (data.conflicts.length === 0) return '';
  return `<section class="conflicts" data-testid="conflicts">
    <h2>需要处理的记录 <span class="count">${data.conflicts.length}</span></h2>
    ${data.conflicts.map((conflict) => `<article class="conflict" data-testid="conflict-item">
      <p><strong>${escapeHtml(conflict.relativePath)}</strong>：${escapeHtml(conflict.error)}</p>
      <pre data-testid="conflict-raw">${escapeHtml(conflict.raw)}</pre>
    </article>`).join('')}
  </section>`;
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
:root { color-scheme: light; font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
* { box-sizing: border-box; }
body { margin: 0 auto; max-width: 1120px; padding: 28px 24px 80px; color: #1f2328; background: #f7f7f5; }
header { border-bottom: 1px solid #d8d8d2; padding-bottom: 18px; margin-bottom: 24px; }
.title-row { display: flex; justify-content: space-between; gap: 24px; align-items: end; }
.eyebrow { margin: 0 0 4px; font-size: 12px; letter-spacing: .12em; text-transform: uppercase; color: #6b6f76; }
h1 { margin: 0; font-size: 28px; }
h2 { font-size: 18px; margin: 0 0 12px; }
h3 { margin: 10px 0 6px; font-size: 18px; }
.quiet { color: #6b6f76; font-size: 13px; }
.filters, .focus { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 14px; }
input, select, button { font: inherit; padding: 6px 8px; border: 1px solid #c9c9c2; border-radius: 6px; background: #fff; }
button { cursor: pointer; background: #1f2328; color: #fff; border-color: #1f2328; }
input[type="search"] { min-width: 220px; }
.focus { margin-top: 10px; }
.group { margin: 26px 0; }
.conflicts { border: 1px solid #d8a3a3; background: #fff7f7; padding: 16px; border-radius: 10px; margin: 20px 0; }
.conflict pre { white-space: pre-wrap; overflow-wrap: anywhere; background: #fff; padding: 10px; border-radius: 6px; }
.card { background: #fff; border: 1px solid #d8d8d2; border-radius: 10px; padding: 14px 16px; margin: 10px 0; }
.card-head { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.id { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 12px; color: #6b6f76; }
.tier, .status, .badge, .count { font-size: 12px; border-radius: 999px; padding: 2px 8px; border: 1px solid #d8d8d2; color: #4a4f57; }
.badge.manual { border-color: #8d7bc4; color: #5b478f; }
.badge.stale { border-color: #b28a3e; color: #7a5a1c; }
.badge.floor { border-color: #5c8b7b; color: #356153; }
.badge.blocked { border-color: #b26b6b; color: #8a3d3d; }
.badge.interview { border-color: #7b8bc4; color: #475a8f; }
.reason { margin: 4px 0 8px; }
.description { color: #444a52; white-space: pre-wrap; }
.deps p { margin: 4px 0; font-size: 13px; color: #555b63; }
.proposals { margin: 8px 0; padding-left: 20px; font-size: 13px; }
.meta { color: #6b6f76; font-size: 12px; }
.actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 10px; }
.inline-form { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.notice { margin: 8px 0; padding: 8px 10px; border: 1px solid #d8c08a; background: #fffbf0; border-radius: 8px; font-size: 13px; }
.notice.danger { border-color: #d8a3a3; background: #fff7f7; }
.notice form { display: inline-flex; gap: 6px; margin-top: 6px; }
.start-entry { margin: 10px 0; border: 1px solid #c7d0dc; background: #f7f9fc; border-radius: 8px; padding: 8px 10px; font-size: 13px; }
.start-entry summary { cursor: pointer; font-weight: 600; }
.start-entry pre { white-space: pre-wrap; overflow-wrap: anywhere; background: #fff; padding: 10px; border-radius: 6px; }
.empty { color: #6b6f76; font-size: 14px; }
.error { color: #a12626; }
mark { background: #ffe58a; color: inherit; padding: 0 1px; }
@media (max-width: 700px) { .title-row { display: block; } }
`;
