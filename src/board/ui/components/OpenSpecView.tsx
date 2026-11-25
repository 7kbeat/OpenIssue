import { Archive, CheckCircle2, FileText, FolderGit2, Link2 } from 'lucide-react';
import type { EvaluatedIssue, ProjectFacts } from '../../types.js';
import { CustomScrollArea, useMediaQuery } from './CustomScrollArea.js';
import { formatShortDate } from './WorkspaceToolbar.js';

interface OpenSpecViewProps {
  facts: ProjectFacts;
  evaluated: EvaluatedIssue[];
  onSelectIssue: (id: string) => void;
  onArchiveChange: (changeId: string) => Promise<void>;
}

export function OpenSpecView({
  facts,
  evaluated,
  onSelectIssue,
  onArchiveChange,
}: OpenSpecViewProps) {
  const byId = new Map(evaluated.map((item) => [item.issue.id, item]));
  const isLg = useMediaQuery('(min-width: 1024px)');

  return (
    <div className="flex flex-1 min-h-0 flex-col gap-4 overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-4 rounded-lg border border-slate-200 bg-white px-5 py-4">
        <div>
          <h2 className="font-display text-base font-bold text-slate-900">
            OpenSpec 提案与规范上下文
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            进行中的提案与任务进度会作为项目事实参与优先级评估；关联关系通过
            .openspec.yaml 中的 x-openissue-issues 双向同步。
          </p>
        </div>
        <span
          className={`rounded-md border px-3 py-1.5 text-xs font-medium ${
            facts.openspecInitialized
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : 'border-amber-300 bg-amber-50 text-amber-900'
          }`}
        >
          {facts.openspecInitialized ? 'OpenSpec 已初始化' : 'OpenSpec 未初始化'}
        </span>
      </div>

      {!facts.openspecInitialized ? (
        <CustomScrollArea className="flex-1 min-h-0" viewportClassName="pr-2">
          <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-6 text-sm text-amber-900">
            <p className="font-semibold">当前锚点仓库尚未初始化 OpenSpec</p>
            <p className="mt-1 text-xs text-amber-800">
              你仍可正常查看需求、调整优先级和维护依赖关系。在初始化 OpenSpec 前，暂时无法从需求创建或关联提案。
            </p>
          </div>
        </CustomScrollArea>
      ) : (
        <CustomScrollArea
          enabled={!isLg}
          className="flex-1 min-h-0 lg:grid lg:grid-cols-3 lg:gap-5 lg:overflow-hidden"
          viewportClassName="space-y-5 pr-2"
        >
          <CustomScrollArea
            as="section"
            enabled={isLg}
            className="lg:col-span-2 lg:h-full lg:min-h-0"
            viewportClassName="lg:pr-3"
          >
            <div className="space-y-4">
              <div className="rounded-lg border border-slate-200 bg-white p-5">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <h3 className="font-display text-sm font-bold text-slate-900">
                    进行中的提案（openspec/changes/）
                  </h3>
                  <span className="font-mono text-xs text-slate-500 tabular-nums">
                    {facts.activeChanges.length} 项
                  </span>
                </div>

                {facts.activeChanges.length === 0 ? (
                  <p className="py-6 text-center text-xs text-slate-400">
                    暂无进行中的提案
                  </p>
                ) : (
                  <div className="mt-3 space-y-3">
                    {facts.activeChanges.map((change) => {
                      const percent =
                        change.tasks.total > 0
                          ? Math.round((change.tasks.done / change.tasks.total) * 100)
                          : 0;
                      return (
                        <article
                          key={change.id}
                          data-testid="active-proposal"
                          className="space-y-2.5 rounded-md border border-slate-200 p-4"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div>
                              <div className="flex items-center gap-2 font-mono text-xs font-semibold text-blue-700">
                                <FolderGit2 className="h-3.5 w-3.5" />
                                <span>{change.id}</span>
                              </div>
                              <div className="mt-1 font-display text-sm font-semibold text-slate-900">
                                {change.title}
                              </div>
                              <div className="mt-0.5 font-mono text-[11px] text-slate-400">
                                {change.path}
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => void onArchiveChange(change.id)}
                              className="inline-flex items-center gap-1 whitespace-nowrap rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                            >
                              <Archive className="h-3.5 w-3.5" />
                              归档提案
                            </button>
                          </div>

                          {change.description ? (
                            <p className="text-xs leading-relaxed text-slate-600">
                              {change.description}
                            </p>
                          ) : null}

                          <div className="flex flex-wrap items-center justify-between gap-3 pt-1 text-xs">
                            <div className="flex min-w-[180px] items-center gap-2">
                              <span className="text-slate-500">任务进度</span>

                              <div className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-100">
                                <div
                                  className="h-full bg-slate-900"
                                  style={{ width: `${percent}%` }}
                                />
                              </div>
                              <span className="font-mono text-slate-700 tabular-nums">
                                {change.tasks.done}/{change.tasks.total}
                              </span>
                            </div>

                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-slate-400">x-openissue-issues:</span>
                              {change.x_openissue_issues.length === 0 ? (
                                <span className="text-slate-400">未关联需求</span>
                              ) : (
                                change.x_openissue_issues.map((issueId) => {
                                  const item = byId.get(issueId);
                                  return (
                                    <button
                                      key={issueId}
                                      type="button"
                                      onClick={() => onSelectIssue(issueId)}
                                      className="inline-flex items-center gap-1 font-mono text-xs font-medium text-slate-800 underline decoration-slate-300 hover:decoration-slate-900"
                                    >
                                      <Link2 className="h-3 w-3 text-slate-400" />
                                      {issueId}
                                      {item
                                        ? ` (${item.issue.status === 'open' ? item.effectiveTier : '已关闭'})`
                                        : ''}
                                    </button>
                                  );
                                })
                              )}
                            </div>
                          </div>

                          {change.rawOpenspecYaml ? (
                            <details className="rounded border border-slate-200 bg-slate-50 px-2.5 py-2 text-[11px]">
                              <summary className="cursor-pointer font-medium text-slate-600">
                                查看 .openspec.yaml 元数据
                              </summary>
                              <pre className="mt-1 whitespace-pre-wrap font-mono text-slate-500">
                                {change.rawOpenspecYaml}
                              </pre>
                            </details>
                          ) : null}
                        </article>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="rounded-lg border border-slate-200 bg-white p-5">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <h3 className="font-display text-sm font-bold text-slate-900">
                    已归档提案（openspec/changes/archive/）
                  </h3>
                  <span className="font-mono text-xs text-slate-500 tabular-nums">
                    {facts.archivedChanges.length} 项
                  </span>
                </div>

                {facts.archivedChanges.length === 0 ? (
                  <p className="py-6 text-center text-xs text-slate-400">暂无归档提案</p>
                ) : (
                  <div className="mt-3 space-y-2.5">
                    {facts.archivedChanges.map((change) => (
                      <article
                        key={change.path}
                        data-testid="archived-proposal"
                        className="space-y-1.5 rounded-md border border-slate-200 px-3.5 py-2.5 text-xs"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono font-semibold text-emerald-800">
                            {change.id}
                          </span>
                          <span className="font-mono text-slate-400 tabular-nums">
                            归档于 {formatShortDate(change.archived_at)}
                          </span>
                        </div>
                        <div className="font-medium text-slate-900">{change.title}</div>
                        <div className="flex flex-wrap items-center gap-2 text-slate-600">
                          <span className="font-mono text-slate-400">{change.path}</span>
                          <span aria-hidden="true">·</span>
                          <span>
                            任务 {change.tasks.done}/{change.tasks.total}
                          </span>
                          <span aria-hidden="true">·</span>
                          {change.x_openissue_issues.map((issueId) => {
                            const item = byId.get(issueId);
                            return (
                              <button
                                key={issueId}
                                type="button"
                                onClick={() => onSelectIssue(issueId)}
                                className="inline-flex items-center gap-1 font-mono font-medium text-slate-800 underline decoration-slate-300 hover:decoration-slate-900"
                              >
                                <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                                {issueId}
                                {item?.readyToConfirmComplete
                                  ? '（待确认完成）'
                                  : item?.issue.status === 'closed'
                                    ? '（已关闭）'
                                    : ''}
                              </button>
                            );
                          })}
                        </div>
                        {change.rawOpenspecYaml ? (
                          <details className="rounded border border-slate-200 bg-slate-50 px-2.5 py-2 text-[11px]">
                            <summary className="cursor-pointer font-medium text-slate-600">
                              查看 .openspec.yaml 元数据
                            </summary>
                            <pre className="mt-1 whitespace-pre-wrap font-mono text-slate-500">
                              {change.rawOpenspecYaml}
                            </pre>
                          </details>
                        ) : null}
                      </article>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </CustomScrollArea>

          <aside className="flex flex-col overflow-hidden rounded-lg border border-slate-200 bg-white lg:h-full lg:min-h-0">
            <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-5 py-3.5">
              <h3 className="font-display text-sm font-bold text-slate-900">
                项目规范（openspec/specs/）
              </h3>
              <span className="font-mono text-xs text-slate-500 tabular-nums">
                {facts.specs.length} 份
              </span>
            </div>
            <CustomScrollArea enabled={isLg} className="lg:flex-1 lg:min-h-0">
              <ul className="space-y-3 px-5 py-4 pr-6">
                {facts.specs.map((spec) => (
                  <li
                    key={spec.id}
                    className="space-y-1 border-b border-slate-100 pb-3 last:border-0 last:pb-0"
                  >
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-900">
                      <FileText className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                      <span>{spec.name}</span>
                    </div>
                    <div className="font-mono text-[11px] text-slate-400">{spec.id}</div>
                    <p className="text-xs leading-relaxed text-slate-600">{spec.summary}</p>
                    <div className="font-mono text-[11px] text-slate-400">{spec.path}</div>
                  </li>
                ))}
              </ul>
            </CustomScrollArea>
          </aside>
        </CustomScrollArea>
      )}
    </div>
  );
}
