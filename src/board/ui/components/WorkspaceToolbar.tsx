import React, { useState } from 'react';
import {
  Check,
  Edit3,
  LayoutGrid,
  List,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { CustomScrollArea } from './CustomScrollArea';
import { hasActiveFilters } from '../domain/search.js';
import type {
  BlockedFilterOption,
  ProductConfig,
  ProjectFacts,
  ProposalFilterOption,
  SearchFilterState,
  StatusFilterOption,
  TierFilterOption,
  WorkspaceState,
} from '../../types.js';

export type BoardLayoutMode = 'columns' | 'list';

interface WorkspaceToolbarProps {
  workspace: WorkspaceState;
  product: ProductConfig;
  facts: ProjectFacts;
  filter: SearchFilterState;
  onChangeFilter: (next: SearchFilterState) => void;
  onResetFilter: () => void;
  layoutMode: BoardLayoutMode;
  onChangeLayoutMode: (mode: BoardLayoutMode) => void;
  onSaveFocus: (text: string) => Promise<void>;
  staleCount: number;
}

export function formatShortDate(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export const WorkspaceToolbar: React.FC<WorkspaceToolbarProps> = ({
  workspace,
  product,
  facts,
  filter,
  onChangeFilter,
  onResetFilter,
  layoutMode,
  onChangeLayoutMode,
  onSaveFocus,
  staleCount,
}) => {
  const [editingFocus, setEditingFocus] = useState(false);
  const [focusDraft, setFocusDraft] = useState(product.focus?.text ?? '');
  const [savingFocus, setSavingFocus] = useState(false);
  const [filtersExpanded, setFiltersExpanded] = useState(false);

  const activeFilters = hasActiveFilters(filter);
  const secondaryFilterCount =
    (filter.tier !== 'all' ? 1 : 0) +
    (filter.proposal !== 'all' ? 1 : 0) +
    (filter.blocked !== 'all' ? 1 : 0);

  const showSecondaryFilters = filtersExpanded || secondaryFilterCount > 0;

  const handleStartEditFocus = () => {
    setFocusDraft(product.focus?.text ?? '');
    setEditingFocus(true);
  };

  const handleCommitFocus = async (textToSave: string) => {
    setSavingFocus(true);
    try {
      await onSaveFocus(textToSave);
      setEditingFocus(false);
    } finally {
      setSavingFocus(false);
    }
  };

  return (
    <CustomScrollArea
      as="section"
      autoHeight
      ariaLabel="当前重点与筛选工具栏"
      className="shrink-0 border-b border-slate-200 bg-white"
      viewportClassName="max-h-[45vh]"
    >
      <div className="w-full px-4 sm:px-6 py-3 space-y-2.5">
        {/* Row 1: In-place Editable Current Focus */}
        <div className="flex items-start sm:items-center gap-3 min-h-[34px]">
          <span className="text-xs font-semibold text-slate-500 whitespace-nowrap shrink-0 pt-0.5 sm:pt-0">
            当前重点
          </span>

          {editingFocus ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void handleCommitFocus(focusDraft);
              }}
              className="flex flex-1 items-center gap-2 min-w-0"
            >
              <label htmlFor="focus-input" className="sr-only">
                当前重点
              </label>
              <input
                id="focus-input"
                data-testid="focus-input"
                type="text"
                value={focusDraft}
                onChange={(e) => setFocusDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setEditingFocus(false);
                  }
                }}
                placeholder="输入当前阶段的产品重点，留空则仅依据项目事实评估"
                className="h-8 flex-1 min-w-0 rounded-md border border-slate-300 bg-white px-2.5 text-sm font-medium text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none"
                autoFocus
              />
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="submit"
                  disabled={savingFocus}
                  data-testid="focus-save"
                  className="inline-flex h-8 items-center gap-1 rounded-md bg-slate-900 px-3 text-xs font-medium text-white hover:bg-slate-800 whitespace-nowrap shrink-0"
                >
                  <Check className="h-3.5 w-3.5" />
                  保存
                </button>
                <button
                  type="button"
                  disabled={savingFocus}
                  onClick={() => setEditingFocus(false)}
                  className="h-8 rounded-md border border-slate-200 px-2.5 text-xs font-medium text-slate-600 hover:bg-slate-50 whitespace-nowrap shrink-0"
                >
                  取消
                </button>
              </div>
            </form>
          ) : (
            <div className="flex flex-1 flex-wrap items-center justify-between gap-x-3 gap-y-1 min-w-0">
              <div className="basis-full sm:basis-auto sm:flex-1 flex items-center gap-2.5 min-w-0">
                {product.focus?.text ? (
                  <span
                    onClick={handleStartEditFocus}
                    title={`点击编辑当前重点（上次更新：${formatShortDate(product.focus.updated_at)}）`}
                    className="min-w-0 sm:truncate text-sm font-medium text-slate-900 cursor-text leading-snug sm:leading-8"
                  >
                    {product.focus.text}
                  </span>
                ) : (
                  <span
                    onClick={handleStartEditFocus}
                    className="text-xs text-amber-700 font-medium cursor-text leading-snug sm:leading-8"
                  >
                    尚未设置重点（目前仅依据项目事实评估）
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2 shrink-0 text-xs">
                {staleCount > 0 && (
                  <span className="text-amber-700 font-medium tabular-nums whitespace-nowrap">
                    {staleCount} 项待刷新
                  </span>
                )}
                {!workspace.assistantAvailable && (
                  <span className="text-red-700 font-medium whitespace-nowrap">
                    助手暂不可用
                  </span>
                )}
                {!facts.openspecInitialized && (
                  <span className="text-amber-700 font-medium whitespace-nowrap">
                    OpenSpec 未初始化
                  </span>
                )}
                {product.focus?.text && (
                  <span className="hidden md:inline text-slate-400 font-mono tabular-nums whitespace-nowrap">
                    {formatShortDate(product.focus.updated_at)}
                  </span>
                )}
                <button
                  type="button"
                  onClick={handleStartEditFocus}
                  className="inline-flex h-7 items-center gap-1 rounded px-2 text-xs font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 whitespace-nowrap shrink-0"
                >
                  <Edit3 className="h-3.5 w-3.5" />
                  编辑重点
                </button>
                {product.focus?.text && (
                  <button
                    type="button"
                    onClick={() => void handleCommitFocus('')}
                    className="h-7 rounded px-2 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-red-700 whitespace-nowrap shrink-0"
                  >
                    清空
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Row 2: Search + Status + Collapsible Filters + Layout Toggle */}
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-2.5">
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <label htmlFor="board-search" className="sr-only">
              搜索需求标题或描述
            </label>
            <input
              id="board-search"
              data-testid="search-input"
              type="search"
              value={filter.query}
              onChange={(e) => onChangeFilter({ ...filter, query: e.target.value })}
              placeholder="按标题、描述或 ID 搜索需求…"
              className="w-full rounded-md border border-slate-200 bg-slate-50 pl-8 pr-3 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:bg-white focus:outline-none"
            />
          </div>

          <div
            role="group"
            aria-label="状态筛选"
            data-testid="status-filter"
            className="flex items-center rounded-md border border-slate-200 bg-slate-100 p-0.5 shrink-0"
          >
            {(
              [
                { value: 'open', label: '仅看打开' },
                { value: 'include_closed', label: '全部状态' },
                { value: 'closed_only', label: '仅看已关闭' },
              ] as Array<{ value: StatusFilterOption; label: string }>
            ).map((opt) => {
              const active = filter.status === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  data-status={opt.value}
                  onClick={() => onChangeFilter({ ...filter, status: opt.value })}
                  className={`rounded px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                    active
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => setFiltersExpanded((v) => !v)}
            aria-expanded={showSecondaryFilters}
            className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
              showSecondaryFilters || secondaryFilterCount > 0
                ? 'border-slate-900 bg-slate-900 text-white'
                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            筛选
            {secondaryFilterCount > 0 && (
              <span className="font-mono tabular-nums">({secondaryFilterCount})</span>
            )}
          </button>

          {activeFilters && (
            <button
              type="button"
              data-testid="clear-filters"
              onClick={onResetFilter}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 whitespace-nowrap shrink-0"
            >
              <X className="h-3.5 w-3.5" />
              清除筛选
            </button>
          )}

          <div
            role="group"
            aria-label="视图切换"
            className="sm:ml-auto flex items-center rounded-md border border-slate-200 bg-slate-100 p-0.5 shrink-0"
          >
            <button
              type="button"
              onClick={() => onChangeLayoutMode('columns')}
              className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium whitespace-nowrap ${
                layoutMode === 'columns'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <LayoutGrid className="h-3.5 w-3.5" />
              分档看板
            </button>
            <button
              type="button"
              onClick={() => onChangeLayoutMode('list')}
              className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium whitespace-nowrap ${
                layoutMode === 'list'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <List className="h-3.5 w-3.5" />
              紧凑列表
            </button>
        </div>
        </div>

        {/* Collapsible Secondary Filters */}
        {showSecondaryFilters && (
          <div className="flex flex-wrap items-center gap-2.5 pt-0.5">
            <label htmlFor="filter-tier" className="sr-only">
              按档位筛选
            </label>
            <select
              id="filter-tier"
              data-testid="tier-filter"
              value={filter.tier}
              onChange={(e) =>
                onChangeFilter({ ...filter, tier: e.target.value as TierFilterOption })
              }
              className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-700 focus:border-slate-900 focus:bg-white focus:outline-none"
            >
              <option value="all">全部档位</option>
              <option value="高">高优先级</option>
              <option value="中">中优先级</option>
              <option value="低">低优先级</option>
              <option value="待评估">待评估</option>
            </select>

            <label htmlFor="filter-proposal" className="sr-only">
              按关联提案筛选
            </label>
            <select
              id="filter-proposal"
              data-testid="linked-filter"
              value={filter.proposal}
              onChange={(e) =>
                onChangeFilter({
                  ...filter,
                  proposal: e.target.value as ProposalFilterOption,
                })
              }
              className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-700 focus:border-slate-900 focus:bg-white focus:outline-none"
            >
              <option value="all">全部提案状态</option>
              <option value="linked">已关联提案</option>
              <option value="unlinked">未关联提案</option>
            </select>

            <label htmlFor="filter-blocked" className="sr-only">
              按阻塞状态筛选
            </label>
            <select
              id="filter-blocked"
              data-testid="blocked-filter"
              value={filter.blocked}
              onChange={(e) =>
                onChangeFilter({
                  ...filter,
                  blocked: e.target.value as BlockedFilterOption,
                })
              }
              className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-700 focus:border-slate-900 focus:bg-white focus:outline-none"
            >
              <option value="all">全部阻塞状态</option>
              <option value="blocked">被前置需求阻塞</option>
              <option value="unblocked">未受阻塞</option>
            </select>
          </div>
        )}
      </div>
    </CustomScrollArea>
  );
};
