import React from 'react';
import { AlertCircle, ArrowRight, GitBranch } from 'lucide-react';
import type { EvaluatedIssue } from '../../types.js';
import { CustomScrollArea } from './CustomScrollArea';

interface DependencyViewProps {
  evaluated: EvaluatedIssue[];
  onSelectIssue: (id: string) => void;
}

export const DependencyView: React.FC<DependencyViewProps> = ({
  evaluated,
  onSelectIssue,
}) => {
  const byId = new Map(evaluated.map((e) => [e.issue.id, e]));

  // Issues that participate in at least one blocking relationship
  const connected = evaluated.filter(
    (e) => e.issue.blocked_by.length > 0 || e.downstreamDeps.length > 0
  );

  // Roots of dependency chains (no upstream deps or upstream not in evaluated)
  const roots = connected.filter(
    (e) => e.issue.blocked_by.length === 0
  );

  const renderChainNode = (
    node: EvaluatedIssue,
    depth = 0,
    visited = new Set<string>()
  ): React.ReactNode => {
    if (visited.has(node.issue.id)) return null;
    const nextVisited = new Set(visited);
    nextVisited.add(node.issue.id);

    const children = node.downstreamDeps
      .map((d) => byId.get(d.id))
      .filter((d): d is EvaluatedIssue => Boolean(d));

    return (
      <div key={node.issue.id} className={depth > 0 ? 'ml-6 border-l border-slate-200 pl-4' : ''}>
        <button
          type="button"
          onClick={() => onSelectIssue(node.issue.id)}
          className="mt-2 flex w-full flex-col gap-1 rounded-md border border-slate-200 bg-white px-4 py-3 text-left transition-colors hover:border-slate-400"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2">
              <span className="font-mono font-semibold text-slate-700">{node.issue.id}</span>
              <span aria-hidden="true" className="text-slate-300">
                ·
              </span>
              {node.issue.status === 'closed' ? (
                <span className="font-medium text-slate-500">
                  已关闭（{node.issue.close_reason === 'completed' ? '已完成' : '不做'}）
                </span>
              ) : (
                <span
                  className={`font-semibold ${
                    node.effectiveTier === '高'
                      ? 'text-red-700'
                      : node.effectiveTier === '中'
                        ? 'text-amber-700'
                        : 'text-slate-700'
                  }`}
                >
                  有效档位：{node.effectiveTier}
                </span>
              )}
              {node.manualOverriddenByRule && (
                <span className="text-amber-700 font-medium">
                  （已保留手动「{node.issue.priority?.manual_tier}」）
                </span>
              )}
            </div>

            <span className="text-slate-400">
              {children.length > 0 ? `阻塞 ${children.length} 项下游需求` : '链条末端'}
            </span>
          </div>

          <div className="font-display text-sm font-semibold text-slate-900">
            {node.issue.title}
          </div>

          <div className="text-xs text-slate-600">{node.reason}</div>
        </button>

        {children.length > 0 && (
          <div className="space-y-1">
            {children.map((child) => renderChainNode(child, depth + 1, nextVisited))}
          </div>
        )}
      </div>
    );
  };

  // Also detect any issues whose upstream is missing/unknown
  const orphanBlocked = connected.filter(
    (e) =>
      e.issue.blocked_by.length > 0 &&
      e.issue.blocked_by.some((upId) => !byId.has(upId))
  );

  return (
    <div className="flex-1 min-h-0 flex flex-col rounded-lg border border-slate-200 bg-white overflow-hidden">
      <div className="shrink-0 flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 px-5 py-4">
        <div>
          <h2 className="font-display text-base font-bold text-slate-900">
            依赖关系与优先级传递
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            前置需求的优先级不会低于它所阻塞的下游需求。前置标记为“已完成”时自动解除阻塞；标记为“不做”时，下游需求会转为“待评估”。
          </p>
        </div>
        <span className="font-mono text-xs text-slate-500 tabular-nums">
          共 {connected.length} 条关联需求
        </span>
      </div>

      <CustomScrollArea
        className="flex-1 min-h-0"
        viewportClassName="p-5 pr-6"
      >
        {connected.length === 0 ? (
          <div className="py-12 text-center text-sm text-slate-500">
            暂无显式依赖关系。点击任意需求卡片，可在右侧面板中添加前置或下游关系。
          </div>
        ) : (
          <div className="space-y-6">
            {roots.map((root) => (
              <div key={root.issue.id} className="rounded-lg bg-slate-50/70 p-4 border border-slate-200/80">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
                  <GitBranch className="h-3.5 w-3.5" />
                  <span>依赖起点</span>
                  <ArrowRight className="h-3.5 w-3.5 text-slate-400" />
                  <span>下游被阻塞需求</span>
                </div>
                {renderChainNode(root)}
              </div>
            ))}

            {orphanBlocked.length > 0 && (
              <div className="rounded-lg border border-red-200 bg-red-50/50 p-4 space-y-2">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-red-900">
                  <AlertCircle className="h-4 w-4 text-red-700" />
                  <span>前置需求暂时无法读取</span>
                </div>
                {orphanBlocked.map((ev) => (
                  <button
                    key={ev.issue.id}
                    type="button"
                    onClick={() => onSelectIssue(ev.issue.id)}
                    className="flex w-full items-center justify-between rounded border border-red-200 bg-white px-3 py-2 text-left text-xs hover:border-red-300"
                  >
                    <div>
                      <span className="font-mono font-semibold text-slate-800">{ev.issue.id}</span>
                      <span className="mx-2 text-slate-300">·</span>
                      <span className="font-medium text-slate-900">{ev.issue.title}</span>
                    </div>
                    <span className="font-medium text-red-700">{ev.reason}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </CustomScrollArea>
    </div>
  );
};
