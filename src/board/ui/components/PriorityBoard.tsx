import React from 'react';
import {
  AlertCircle,
  CheckCircle2,
  GitBranch,
  Hand,
  Link2,
  Link2Off,
  RefreshCw,
} from 'lucide-react';
import type {
  EffectiveTier,
  EvaluatedIssue,
  PriorityTier,
} from '../../types.js';
import { CustomScrollArea } from './CustomScrollArea';
import { formatShortDate, type BoardLayoutMode } from './WorkspaceToolbar';

interface PriorityBoardProps {
  evaluated: EvaluatedIssue[];
  searchQuery: string;
  layoutMode: BoardLayoutMode;
  selectedIssueId: string | null;
  onSelectIssue: (id: string) => void;
  onSetManualTier: (id: string, tier: PriorityTier | null) => Promise<void>;
  onConfirmComplete: (id: string) => Promise<void>;
  onResetFilters: () => void;
}

const LANE_CONFIG: Array<{
  tier: EffectiveTier;
  title: string;
  tooltip: string;
  headerAccent: string;
  testId: string;
}> = [
  {
    tier: '高',
    title: '高优先级',
    tooltip: '直接推进当前重点，或阻塞了高优先级需求',
    headerAccent: 'text-red-700',
    testId: 'group-high',
  },
  {
    tier: '中',
    title: '中优先级',
    tooltip: '有明确的规格或阶段性推进依据',
    headerAccent: 'text-amber-700',
    testId: 'group-medium',
  },
  {
    tier: '低',
    title: '低优先级',
    tooltip: '可延后处理，暂不阻塞高优工作',
    headerAccent: 'text-slate-700',
    testId: 'group-low',
  },
  {
    tier: '待评估',
    title: '待评估',
    tooltip: '缺少足够依据、前置已放弃，或等待助手判断',
    headerAccent: 'text-slate-600',
    testId: 'group-unassessed',
  },
];

function evaluatedJudgedAt(ev: EvaluatedIssue): string | undefined {
  return ev.judgedAt ?? ev.issue.priority.judged_at;
}

function HighlightText({ text, query }: { text: string; query: string }) {
  const q = query.trim();
  if (!q) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return <>{text}</>;
  const before = text.slice(0, idx);
  const match = text.slice(idx, idx + q.length);
  const after = text.slice(idx + q.length);
  return (
    <>
      {before}
      <mark className="rounded-xs bg-amber-200/80 px-0.5 text-slate-900">{match}</mark>
      {after}
    </>
  );
}

const IssueCard: React.FC<{
  ev: EvaluatedIssue;
  searchQuery: string;
  isSelected: boolean;
  onSelect: () => void;
  onSetManualTier: (tier: PriorityTier | null) => Promise<void>;
  onConfirmComplete: () => Promise<void>;
}> = ({
  ev,
  searchQuery,
  isSelected,
  onSelect,
  onSetManualTier,
  onConfirmComplete,
}) => {
  const { issue } = ev;
  const openDownstream = ev.downstreamDeps.filter((d) => d.status === 'open');
  const openUpstream = ev.upstreamDeps.filter((u) => u.status === 'open');

  const hasSignals =
    ev.isManual ||
    ev.isStale ||
    ev.hasAbandonedUpstream ||
    ev.hasUnknownUpstream ||
    openUpstream.length > 0 ||
    openDownstream.length > 0 ||
    ev.proposalStatuses.length > 0 ||
    ev.hasSnapshotDiff ||
    ev.dependencyFloor ||
    ev.invalidDependency ||
    Boolean(ev.blockedReason) ||
    ev.startContext?.interview.status === 'incomplete' ||
    ev.startContext?.interview.status === 'completed';

  return (
    <article
      data-testid="issue-card"
      data-issue-id={issue.id}
      data-tier={ev.effectiveTier ?? 'closed'}
      className={`group relative rounded-lg border bg-white p-4 transition-colors duration-150 ${
        isSelected
          ? 'border-slate-900 ring-1 ring-slate-900'
          : 'border-slate-200 hover:border-slate-300'
      }`}
    >
      {/* Quick tier adjustment revealed on hover / focus (no permanent clutter on resting cards) */}
      {issue.status === 'open' && (
        <div
          role="group"
          aria-label={`调整 ${issue.id} 档位`}
          className="absolute right-3 top-3 z-10 flex items-center gap-0.5 rounded-md border border-slate-200 bg-white/95 p-0.5 shadow-xs transition-opacity duration-150 [@media(hover:hover)]:opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
        >
          {(['高', '中', '低'] as PriorityTier[]).map((t) => {
            const isManualThis = issue.priority?.manual_tier === t;
            return (
              <button
                key={t}
                type="button"
                onClick={() => void onSetManualTier(t)}
                aria-pressed={isManualThis}
                className={`rounded px-1.5 py-0.5 text-[11px] font-medium transition-colors ${
                  isManualThis
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                {t}
              </button>
            );
          })}
          {ev.isManual && (
            <button
              type="button"
              onClick={() => void onSetManualTier(null)}
              className="rounded px-1.5 py-0.5 text-[11px] font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            >
              自动
            </button>
          )}
        </div>
      )}

      {/* Clickable primary card body */}
      <button
        type="button"
        onClick={onSelect}
        className="w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 rounded"
      >
        {/* Minimal top identifier */}
        <div className="flex items-center justify-between gap-2 text-[11px] text-slate-400">
          <div className="flex items-center gap-1.5 font-mono tabular-nums">
            <span data-testid="issue-id">{issue.id}</span>
            {ev.effectiveTier ? (
              <>
                <span aria-hidden="true">·</span>
                <span data-testid="issue-tier">{ev.effectiveTier}</span>
                <span aria-hidden="true">·</span>
                <span>#{ev.sortRank}</span>
              </>
            ) : null}
          </div>
          <span
            data-testid="issue-status"
            className="whitespace-nowrap font-sans font-medium text-slate-500"
          >
            {issue.status === 'closed'
              ? `已关闭 · ${issue.close_reason === 'completed' ? '已完成' : '不做'}`
              : '打开'}
          </span>
        </div>

        {/* Title */}
        <h3
          data-testid="issue-title"
          className="mt-1.5 font-display text-[15px] font-semibold leading-snug text-slate-900"
        >
          <HighlightText text={issue.title} query={searchQuery} />
        </h3>

        {/* Reason */}
        <p
          data-testid="issue-reason"
          className="mt-1.5 text-xs leading-relaxed text-slate-600"
        >
          {ev.reason}
        </p>

        {/* Actionable signals only (no redundant static timestamps or source noise) */}
        {hasSignals && (
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            {ev.isManual ? (
              <span
                data-testid="manual-badge"
                className="inline-flex items-center gap-1 font-medium text-slate-700"
              >
                <Hand className="h-3 w-3 text-slate-500" />
                {ev.manualOverriddenByRule
                  ? `手动设定「${issue.priority?.manual_tier}」（已被规则覆盖）`
                  : '手动设定'}
              </span>
            ) : null}

            {ev.dependencyFloor ? (
              <span
                data-testid="floor-badge"
                className="inline-flex items-center gap-1 font-medium text-amber-700"
              >
                依赖下限
              </span>
            ) : null}

            {ev.invalidDependency ? (
              <span
                data-testid="invalid-dependency-badge"
                className="inline-flex items-center gap-1 font-medium text-red-700"
              >
                <AlertCircle className="h-3 w-3" />
                依赖失效
              </span>
            ) : null}

            {ev.isBlocked ? (
              <span
                data-testid="blocked-badge"
                className="inline-flex items-center gap-1 font-medium text-amber-700"
              >
                <AlertCircle className="h-3 w-3" />
                被阻塞
              </span>
            ) : null}

            {ev.isStale ? (
              <span
                data-testid="stale-badge"
                className="inline-flex items-center gap-1 font-medium text-amber-700"
                title={`上次判断时间：${evaluatedJudgedAt(ev)}`}
              >
                <RefreshCw className="h-3 w-3" />
                待刷新（{formatShortDate(evaluatedJudgedAt(ev))} 判断）
              </span>
            ) : null}

            {ev.hasAbandonedUpstream ? (
              <span className="inline-flex items-center gap-1 font-medium text-red-700">
                <AlertCircle className="h-3 w-3" />
                前置已放弃
              </span>
            ) : null}

            {ev.hasUnknownUpstream ? (
              <span className="inline-flex items-center gap-1 font-medium text-red-700">
                <AlertCircle className="h-3 w-3" />
                前置状态不明
              </span>
            ) : null}

            {openUpstream.length > 0 ? (
              <span
                data-testid="issue-waiting"
                className="inline-flex items-center gap-1 text-slate-500"
                title={openUpstream.map((item) => item.id).join('、')}
              >
                <GitBranch className="h-3 w-3 text-slate-400" />
                等待前置 {openUpstream.length} 项
              </span>
            ) : null}

            {openDownstream.length > 0 ? (
              <span
                data-testid="issue-blocking"
                className="inline-flex items-center gap-1 font-medium text-slate-700"
                title={openDownstream.map((item) => item.id).join('、')}
              >
                <GitBranch className="h-3 w-3 text-slate-500" />
                阻塞下游 {openDownstream.length} 项
              </span>
            ) : null}

            {ev.proposalStatuses.length > 0 ? (
              <span data-testid="issue-proposals" className="contents">
                {ev.proposalStatuses.map((p) => (
                  <span
                    key={p.id}
                    data-testid={p.state === 'missing' ? 'invalid-link-badge' : 'proposal-item'}
                    className={`inline-flex items-center gap-1 font-mono ${
                      p.state === 'missing'
                        ? 'font-medium text-red-700'
                        : p.state === 'archived'
                          ? 'font-medium text-emerald-700'
                          : 'text-blue-700'
                    }`}
                  >
                    {p.state === 'missing' ? (
                      <Link2Off className="h-3 w-3" />
                    ) : (
                      <Link2 className="h-3 w-3" />
                    )}
                    {p.state === 'missing'
                      ? `关联已失效：${p.id}`
                      : `${p.id}${
                          p.tasks && p.tasks.total > 0
                            ? ` (${p.tasks.done}/${p.tasks.total})`
                            : ''
                        }`}
                  </span>
                ))}
              </span>
            ) : null}

            {ev.startContext?.interview.status === 'incomplete' ? (
              <span
                data-testid="interview-badge"
                className="font-medium text-amber-700"
              >
                访谈未完成
              </span>
            ) : null}

            {ev.startContext?.interview.status === 'completed' ? (
              <span
                data-testid="interview-completed-badge"
                className="font-medium text-emerald-700"
              >
                访谈已完成
              </span>
            ) : null}

            {ev.hasSnapshotDiff ? (
              <span data-testid="snapshot-updated" className="font-medium text-amber-700">
                关联后需求有更新
              </span>
            ) : null}

            {ev.blockedReason && !ev.invalidDependency ? (
              <span className="text-amber-700">{ev.blockedReason}</span>
            ) : null}
          </div>
        )}

        <div
          data-testid="issue-meta"
          className="mt-3 border-t border-slate-100 pt-2 font-mono text-[10px] text-slate-400"
          title={`创建 ${issue.created_at} · 更新 ${issue.updated_at}`}
        >
          作者 {issue.author} · 创建 {formatShortDate(issue.created_at)} · 更新{' '}
          {formatShortDate(issue.updated_at)}
        </div>
      </button>

      {/* Archive confirmation CTA */}
      {ev.readyToConfirmComplete && (
        <div
          data-testid="archived-prompt"
          className="mt-3 flex items-center justify-between gap-2 border-t border-slate-100 pt-2.5 text-xs"
        >
          <span className="inline-flex items-center gap-1 font-medium text-emerald-800">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-700 shrink-0" />
            关联提案已归档，可确认完成
          </span>
          <button
            type="button"
            onClick={() => void onConfirmComplete()}
            className="rounded bg-emerald-700 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-800 whitespace-nowrap"
          >
            确认完成
          </button>
        </div>
      )}
    </article>
  );
};

export const PriorityBoard: React.FC<PriorityBoardProps> = ({
  evaluated,
  searchQuery,
  layoutMode,
  selectedIssueId,
  onSelectIssue,
  onSetManualTier,
  onConfirmComplete,
  onResetFilters,
}) => {
  if (evaluated.length === 0) {
    return (
      <CustomScrollArea className="flex-1 min-h-0" viewportClassName="pr-2">
        <div
          data-testid="empty-state"
          className="rounded-lg border border-slate-200 bg-white px-6 py-16 text-center"
        >
          <p className="font-display text-base font-semibold text-slate-900">
            没有找到匹配的需求
          </p>
          <p className="mt-1.5 text-sm text-slate-500">
            可以尝试更换搜索关键词，或重置筛选条件后查看全部需求。
          </p>
          <button
            type="button"
            onClick={onResetFilters}
            className="mt-4 rounded-md border border-slate-300 bg-white px-4 py-2 text-xs font-medium text-slate-800 hover:bg-slate-50"
          >
            清除筛选条件
          </button>
        </div>
      </CustomScrollArea>
    );
  }

  const openEvaluated = evaluated.filter((e) => e.issue.status === 'open');
  const closedEvaluated = evaluated.filter((e) => e.issue.status === 'closed');

  if (layoutMode === 'list') {
    return (
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden rounded-lg border border-slate-200 bg-white">
        <CustomScrollArea direction="both" className="flex-1 min-h-0">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur-xs">
              <tr className="border-b border-slate-200 text-xs font-semibold text-slate-600">
                <th className="px-4 py-2.5">优先级</th>
                <th className="px-4 py-2.5">需求</th>
                <th className="px-4 py-2.5">判断依据</th>
                <th className="px-4 py-2.5">状态与关联</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {evaluated.map((ev) => (
                <tr
                  key={ev.issue.id}
                  className={`transition-colors hover:bg-slate-50 ${
                    selectedIssueId === ev.issue.id ? 'bg-slate-100/70' : ''
                  }`}
                >
                  <td className="px-4 py-3 align-top whitespace-nowrap">
                    {ev.effectiveTier ? (
                      <div className="flex items-center gap-1.5 font-mono text-xs tabular-nums">
                        <span
                          className={`font-semibold ${
                            ev.effectiveTier === '高'
                              ? 'text-red-700'
                              : ev.effectiveTier === '中'
                                ? 'text-amber-700'
                                : 'text-slate-700'
                          }`}
                        >
                          {ev.effectiveTier}
                        </span>
                        <span className="text-slate-300">/</span>
                        <span className="text-slate-400">#{ev.sortRank}</span>
                      </div>
                    ) : (
                      <span className="text-xs font-medium text-slate-500">
                        已关闭
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 align-top max-w-md">
                    <button
                      type="button"
                      onClick={() => onSelectIssue(ev.issue.id)}
                      className="text-left focus-visible:outline-none focus-visible:underline"
                    >
                      <div className="font-mono text-[11px] text-slate-400">
                        {ev.issue.id}
                      </div>
                      <div className="mt-0.5 font-medium text-slate-900">
                        <HighlightText text={ev.issue.title} query={searchQuery} />
                      </div>
                    </button>
                  </td>
                  <td className="px-4 py-3 align-top max-w-lg text-xs text-slate-600">
                    {ev.reason}
                  </td>
                  <td className="px-4 py-3 align-top text-xs text-slate-600 whitespace-nowrap">
                    <div className="flex flex-wrap gap-x-2.5 gap-y-1">
                      {ev.isManual && <span>手动</span>}
                      {ev.isStale && <span className="text-amber-700 font-medium">待刷新</span>}
                      {ev.issue.blocked_by.length > 0 && (
                        <span>前置 {ev.issue.blocked_by.length}</span>
                      )}
                      {ev.proposalStatuses.map((p) => (
                        <span key={p.id} className="font-mono text-blue-700">
                          {p.id}
                        </span>
                      ))}
                      {!ev.isManual &&
                        !ev.isStale &&
                        ev.issue.blocked_by.length === 0 &&
                        ev.proposalStatuses.length === 0 && (
                          <span className="text-slate-300">—</span>
                        )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CustomScrollArea>
      </div>
    );
  }

  return (
    <CustomScrollArea className="flex-1 min-h-0" viewportClassName="space-y-6 pr-3">
      {/* Priority Lanes — auto-match columns to browser width */}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-5 items-start">
        {LANE_CONFIG.map((lane) => {
          const items = openEvaluated
            .filter((item) => item.effectiveTier === lane.tier)
            .sort((a, b) => a.sortRank - b.sortRank);
          return (
            <section
              key={lane.tier}
              aria-label={`${lane.title}分组`}
              data-testid={lane.testId}
              className="@container flex flex-col rounded-lg border border-slate-200 bg-slate-100/60 p-3.5"
            >
              <header
                title={lane.tooltip}
                className="mb-3 flex items-baseline justify-between gap-2 px-1"
              >
                <h2 className={`font-display text-sm font-bold ${lane.headerAccent}`}>
                  {lane.title}
                </h2>
                <span className="font-mono text-xs font-semibold text-slate-400 tabular-nums">
                  {items.length}
                </span>
              </header>

              <div className="grid grid-cols-1 @[580px]:grid-cols-2 gap-3">
                {items.length === 0 ? (
                  <div className="@[580px]:col-span-2 rounded-md border border-dashed border-slate-200 bg-white/60 px-3 py-6 text-center text-xs text-slate-400">
                    暂无需求
                  </div>
                ) : (
                  items.map((ev) => (
                    <IssueCard
                      key={ev.issue.id}
                      ev={ev}
                      searchQuery={searchQuery}
                      isSelected={selectedIssueId === ev.issue.id}
                      onSelect={() => onSelectIssue(ev.issue.id)}
                      onSetManualTier={(tier) => onSetManualTier(ev.issue.id, tier)}
                      onConfirmComplete={() => onConfirmComplete(ev.issue.id)}
                    />
                  ))
                )}
              </div>
            </section>
          );
        })}
      </div>

      {/* Closed Issues section (only appears when status filter includes closed) */}
      {closedEvaluated.length > 0 && (
        <section
          aria-label="已关闭需求"
          data-testid="closed-section"
          className="rounded-lg border border-slate-200 bg-white p-4"
        >
          <div className="flex items-baseline justify-between border-b border-slate-100 pb-3">
            <h2 className="font-display text-sm font-bold text-slate-900">
              已关闭需求（不参与优先级排序）
            </h2>
            <span className="font-mono text-xs font-semibold text-slate-500 tabular-nums">
              {closedEvaluated.length}
            </span>
          </div>

          <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-3">
            {closedEvaluated.map((ev) => (
              <IssueCard
                key={ev.issue.id}
                ev={ev}
                searchQuery={searchQuery}
                isSelected={selectedIssueId === ev.issue.id}
                onSelect={() => onSelectIssue(ev.issue.id)}
                onSetManualTier={() => Promise.resolve()}
                onConfirmComplete={() => Promise.resolve()}
              />
            ))}
          </div>
        </section>
      )}
    </CustomScrollArea>
  );
};
