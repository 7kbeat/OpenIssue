import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  Check,
  CheckCircle2,
  Copy,
  GitBranch,
  Link2,
  Link2Off,
  RotateCcw,
  Terminal,
  Trash2,
  X,
} from 'lucide-react';
import type {
  CloseReason,
  EvaluatedIssue,
  IssueRecord,
  OpenSpecChange,
  PriorityTier,
} from '../../types.js';
import { CustomScrollArea } from './CustomScrollArea';
import { MarkdownContent } from './MarkdownContent';
import { formatShortDate } from './WorkspaceToolbar';

interface IssueInspectorDrawerProps {
  evaluated: EvaluatedIssue | null;
  allIssues: IssueRecord[];
  activeChanges: OpenSpecChange[];
  openspecInitialized: boolean;
  onCloseDrawer: () => void;
  onSetManualTier: (id: string, tier: PriorityTier | null) => Promise<void>;
  onCloseIssue: (id: string, reason: CloseReason | undefined, note?: string) => Promise<void>;
  onReopenIssue: (id: string) => Promise<void>;
  onAddDependency: (blockerId: string, blockedId: string) => Promise<void>;
  onRemoveDependency: (blockerId: string, blockedId: string) => Promise<void>;
  onReplaceDependency: (
    blockedId: string,
    oldBlockerId: string,
    newBlockerId: string
  ) => Promise<void>;
  onLinkProposal: (id: string, changeId: string) => Promise<void>;
  onConfirmComplete: (id: string) => Promise<void>;
}

const PRECEDENCE_LABELS: Record<string, string> = {
  closed_excluded: '1. 已关闭（不参与排序）',
  dependency_abandoned: '2. 依赖失效（前置已放弃）',
  dependency_unknown: '2. 依赖失效（前置状态不明）',
  dependency_floor: '3. 受依赖下限抬升',
  manual_override: '4. 手动设定',
  assistant_judgment: '5. 助手语义判断',
  pending_evaluation: '5. 待评估',
};

export const IssueInspectorDrawer: React.FC<IssueInspectorDrawerProps> = ({
  evaluated,
  allIssues,
  activeChanges,
  openspecInitialized,
  onCloseDrawer,
  onSetManualTier,
  onCloseIssue,
  onReopenIssue,
  onAddDependency,
  onRemoveDependency,
  onReplaceDependency,
  onLinkProposal,
  onConfirmComplete,
}) => {
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copiedCmd, setCopiedCmd] = useState(false);
  const [copiedStart, setCopiedStart] = useState(false);

  // Close issue form state
  const [showCloseForm, setShowCloseForm] = useState(false);
  const [closeReason, setCloseReason] = useState<CloseReason | ''>('');
  const [closeNote, setCloseNote] = useState('');

  // Dependency add/replace state
  const [newBlockerId, setNewBlockerId] = useState('');
  const [replacingBlockerId, setReplacingBlockerId] = useState<string | null>(null);
  const [replacementId, setReplacementId] = useState('');

  // OpenSpec handoff state
  const [selectedExistingChange, setSelectedExistingChange] = useState('');
  const [relinkMissingId, setRelinkMissingId] = useState<string | null>(null);
  const [deferredConfirmNote, setDeferredConfirmNote] = useState(false);

  useEffect(() => {
    setErrorMsg(null);
    setShowCloseForm(false);
    setCloseReason('');
    setCloseNote('');
    setNewBlockerId('');
    setReplacingBlockerId(null);
    setReplacementId('');
    setSelectedExistingChange(activeChanges[0]?.id ?? '');
    setRelinkMissingId(null);
    setDeferredConfirmNote(false);
    setCopiedStart(false);
  }, [evaluated?.issue.id, activeChanges]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && evaluated) {
        onCloseDrawer();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [evaluated, onCloseDrawer]);

  if (!evaluated) return null;

  const { issue } = evaluated;
  const otherIssues = allIssues.filter((i) => i.id !== issue.id);
  const hasActiveProposal = evaluated.proposalStatuses.some((p) => p.state === 'active');
  const startContext = evaluated.startContext;

  const runAction = async (fn: () => Promise<void>) => {
    setErrorMsg(null);
    try {
      await fn();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  const handleCopyCli = () => {
    const cmd = `openissue edit ${issue.id}`;
    if (navigator.clipboard) void navigator.clipboard.writeText(cmd).catch(() => undefined);
    setCopiedCmd(true);
    setTimeout(() => setCopiedCmd(false), 1500);
  };

  const handleCopyStart = () => {
    if (!startContext?.instruction) return;
    if (navigator.clipboard) {
      void navigator.clipboard.writeText(startContext.instruction).catch(() => undefined);
    }
    setCopiedStart(true);
    setTimeout(() => setCopiedStart(false), 1500);
  };

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-slate-900/20 backdrop-blur-[1px]">
      <div
        className="flex-1"
        onClick={onCloseDrawer}
        aria-hidden="true"
      />
      <aside
        aria-label={`需求详情 ${issue.id}`}
        data-testid="issue-inspector"
        className="relative flex h-full w-full max-w-xl flex-col border-l border-slate-200 bg-white shadow-xl"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
              <span className="font-mono font-semibold text-slate-800">{issue.id}</span>
              <span aria-hidden="true">·</span>
              <span
                className={`font-semibold ${
                  issue.status === 'open' ? 'text-emerald-700' : 'text-slate-600'
                }`}
              >
                {issue.status === 'open'
                  ? '打开中'
                  : `已关闭 · ${issue.close_reason === 'completed' ? '已完成' : '不做'}`}
              </span>
              <span aria-hidden="true">·</span>
              <span>由 {issue.author} 记录</span>
              <span aria-hidden="true">·</span>
              <span>
                来源：
                {issue.source === 'cli' ? '命令行' : issue.source === 'board' ? '看板' : issue.source}
              </span>
              <span aria-hidden="true">·</span>
              <span>产品：{issue.product_id}</span>
            </div>
            <h2 className="mt-1.5 font-display text-lg font-bold leading-snug text-slate-900">
              {issue.title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onCloseDrawer}
            aria-label="关闭详情抽屉"
            className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-900 shrink-0"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Scrollable Body */}
        <CustomScrollArea
          className="flex-1 min-h-0"
          viewportClassName="px-6 py-5 pr-7 space-y-6"
        >
          {errorMsg && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-medium text-red-800"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-700" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Description + CLI-only capture/edit reminder */}
          <section className="space-y-2.5">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span className="font-semibold text-slate-700">需求描述（只读）</span>
              <span className="font-mono tabular-nums">
                创建于 {formatShortDate(issue.created_at)} · 更新于 {formatShortDate(issue.updated_at)}
              </span>
            </div>
            {issue.description.trim() ? (
              <MarkdownContent
                content={issue.description}
                testId="issue-description-markdown"
              />
            ) : (
              <p className="text-sm italic text-slate-400">
                暂未填写补充描述
              </p>
            )}
            {issue.close ? (
              <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                关闭原因：
                <strong className="ml-1 text-slate-900">
                  {issue.close.reason === 'completed' ? '已完成' : '不做'}
                </strong>
                {issue.close.note ? <span className="ml-1.5">（{issue.close.note}）</span> : null}
                <span className="ml-2 font-mono text-slate-400">
                  {formatShortDate(issue.close.closed_at)}
                </span>
              </div>
            ) : null}
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
              <div className="flex items-center gap-2 min-w-0">
                <Terminal className="h-3.5 w-3.5 text-slate-500 shrink-0" />
                <span>
                  如需修改标题或描述，请在终端运行：
                  <code className="ml-1 font-mono text-slate-900 whitespace-nowrap">
                    openissue edit {issue.id}
                  </code>
                </span>
              </div>
              <button
                type="button"
                onClick={handleCopyCli}
                className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium text-slate-700 hover:bg-slate-200/70 whitespace-nowrap shrink-0"
              >
                {copiedCmd ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                {copiedCmd ? '已复制' : '复制命令'}
              </button>
            </div>
          </section>

          <hr className="border-slate-200" />

          {/* Prioritization & Rule Precedence */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-sm font-bold text-slate-900">
                优先级与判断依据
              </h3>
              <span className="text-xs font-medium text-slate-500">
                {PRECEDENCE_LABELS[evaluated.precedenceStage]}
              </span>
            </div>

            <div className="space-y-2 text-sm">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="text-xs text-slate-500">当前有效档位</span>
                <span className="font-semibold text-slate-900">
                  {evaluated.effectiveTier ?? '不参与排序（已关闭）'}
                </span>
                {evaluated.effectiveTier && (
                  <span className="font-mono text-xs text-slate-500 tabular-nums">
                    档内第 #{evaluated.sortRank} 位
                  </span>
                )}
                {evaluated.isStale && (
                  <span className="text-xs font-medium text-amber-700">
                    输入已变化，建议重新评估
                  </span>
                )}
              </div>

              <p className="text-xs leading-relaxed text-slate-600">
                <strong className="font-medium text-slate-800">判断依据：</strong>
                {evaluated.reason}
              </p>

              {evaluated.basis.length > 0 ? (
                <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                  <span>依据引用：</span>
                  {evaluated.basis.map((basis) => (
                    <code
                      key={basis}
                      className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-700"
                    >
                      {basis}
                    </code>
                  ))}
                </div>
              ) : null}

              {evaluated.invalidReason ? (
                <p className="rounded border border-red-200 bg-red-50 px-2.5 py-2 text-xs text-red-800">
                  {evaluated.invalidReason}
                </p>
              ) : null}
              {evaluated.blockedReason && !evaluated.invalidReason ? (
                <p className="rounded border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs text-amber-900">
                  {evaluated.blockedReason}
                </p>
              ) : null}

              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500 font-mono tabular-nums">
                <span>
                  上次判断：
                  {evaluated.judgedAt
                    ? formatShortDate(evaluated.judgedAt)
                    : issue.priority?.judged_at
                      ? formatShortDate(issue.priority.judged_at)
                      : '尚未判断'}
                </span>
                <span>输入摘要：{evaluated.currentInputHash || '—'}</span>
                {issue.priority?.input_hash ? (
                  <span>缓存摘要：{issue.priority.input_hash}</span>
                ) : null}
                {issue.priority?.manual_at ? (
                  <span>手动设定：{formatShortDate(issue.priority.manual_at)}</span>
                ) : null}
                <span>依赖深度：{evaluated.dependencyDepth}</span>
              </div>

              {evaluated.manualOverriddenByRule && issue.priority?.manual_tier && (
                <p className="text-xs text-amber-800">
                  已保留你的手动设定「{issue.priority.manual_tier}」，目前因
                  {evaluated.precedenceStage === 'dependency_floor' ? '依赖下限' : '依赖失效'}
                  规则暂不生效；待前置约束解除后会自动恢复。
                </p>
              )}
            </div>

            {issue.status === 'open' && (
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <span className="text-xs text-slate-500">手动调整档位：</span>
                {(['高', '中', '低'] as PriorityTier[]).map((t) => {
                  const active = issue.priority?.manual_tier === t;
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => void runAction(() => onSetManualTier(issue.id, t))}
                      className={`rounded-md border px-3 py-1 text-xs font-medium transition-colors ${
                        active
                          ? 'border-slate-900 bg-slate-900 text-white'
                          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      {t}
                    </button>
                  );
                })}
                {evaluated.isManual && (
                  <button
                    type="button"
                    onClick={() => void runAction(() => onSetManualTier(issue.id, null))}
                    className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    <RotateCcw className="h-3 w-3" />
                    恢复自动判断
                  </button>
                )}
              </div>
            )}
          </section>

          <hr className="border-slate-200" />

          {/* Dependencies */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-sm font-bold text-slate-900">
                前置与下游依赖
              </h3>
              <span className="text-xs text-slate-500">仅按显式声明计算，不会自动推断</span>
            </div>

            {/* Upstream blockers */}
            <div className="space-y-2">
              <div className="text-xs font-semibold text-slate-600">
                需等待以下前置需求完成（{evaluated.upstreamDeps.length}）
              </div>
              {evaluated.upstreamDeps.length === 0 ? (
                <p className="text-xs text-slate-400">暂无前置需求，可直接推进</p>
              ) : (
                <ul className="space-y-2">
                  {evaluated.upstreamDeps.map((up) => (
                    <li
                      key={up.id}
                      className="flex flex-col gap-2 rounded-md border border-slate-200 px-3 py-2 text-xs"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <span className="font-mono text-slate-500">{up.id}</span>
                          <span className="mx-1.5 text-slate-300">·</span>
                          <span className="font-medium text-slate-900">{up.title}</span>
                          <span className="mx-1.5 text-slate-300">·</span>
                          <span
                            className={
                              up.status === 'unknown' || up.close_reason === 'wont_do'
                                ? 'font-semibold text-red-700'
                                : up.close_reason === 'completed'
                                  ? 'text-emerald-700'
                                  : 'text-slate-600'
                            }
                          >
                            {up.status === 'open'
                              ? `打开中 (${up.effectiveTier ?? '待评估'})`
                              : up.status === 'unknown'
                                ? '无法读取'
                                : up.close_reason === 'completed'
                                  ? '已完成（已解除阻塞）'
                                  : '已放弃（不做）'}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => {
                              setReplacingBlockerId(up.id);
                              setReplacementId(otherIssues[0]?.id ?? '');
                            }}
                            className="rounded px-2 py-0.5 text-xs font-medium text-slate-600 hover:bg-slate-100"
                          >
                            更换
                          </button>
                          <button
                            type="button"
                            aria-label={`移除前置需求 ${up.id}`}
                            onClick={() =>
                              void runAction(() => onRemoveDependency(up.id, issue.id))
                            }
                            className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-700"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>

                      {replacingBlockerId === up.id && (
                        <div className="flex items-center gap-2 border-t border-slate-100 pt-2">
                          <select
                            value={replacementId}
                            onChange={(e) => setReplacementId(e.target.value)}
                            aria-label="选择新的前置需求"
                            className="flex-1 rounded border border-slate-200 px-2 py-1 text-xs"
                          >
                            {otherIssues
                              .filter((o) => o.id !== up.id)
                              .map((o) => (
                                <option key={o.id} value={o.id}>
                                  {o.id} — {o.title}
                                </option>
                              ))}
                          </select>
                          <button
                            type="button"
                            onClick={() =>
                              void runAction(async () => {
                                await onReplaceDependency(issue.id, up.id, replacementId);
                                setReplacingBlockerId(null);
                              })
                            }
                            className="rounded bg-slate-900 px-2.5 py-1 text-xs font-medium text-white"
                          >
                            确认更换
                          </button>
                          <button
                            type="button"
                            onClick={() => setReplacingBlockerId(null)}
                            className="rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-100"
                          >
                            取消
                          </button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Downstream blocked */}
            {evaluated.downstreamDeps.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-xs font-semibold text-slate-600">
                  正在阻塞以下下游需求（{evaluated.downstreamDeps.length}）
                </div>
                <ul className="space-y-1 text-xs text-slate-700">
                  {evaluated.downstreamDeps.map((down) => (
                    <li key={down.id} className="flex items-center gap-2">
                      <GitBranch className="h-3.5 w-3.5 text-slate-400" />
                      <span className="font-mono text-slate-500">{down.id}</span>
                      <span>{down.title}</span>
                      <span className="text-slate-400">
                        ({down.status === 'open' ? down.effectiveTier ?? '待评估' : '已关闭'})
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Add new dependency */}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <label htmlFor="add-blocker-select" className="sr-only">
                选择前置阻塞需求
              </label>
              <select
                id="add-blocker-select"
                value={newBlockerId}
                onChange={(e) => setNewBlockerId(e.target.value)}
                className="flex-1 min-w-[200px] rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700"
              >
                <option value="">选择一个前置需求…</option>
                {otherIssues
                  .filter((o) => !issue.blocked_by.includes(o.id))
                  .map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.id} · {o.title}
                    </option>
                  ))}
              </select>
              <button
                type="button"
                disabled={!newBlockerId}
                onClick={() =>
                  void runAction(async () => {
                    await onAddDependency(newBlockerId, issue.id);
                    setNewBlockerId('');
                  })
                }
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-40 whitespace-nowrap"
              >
                添加前置
              </button>
            </div>
          </section>

          <hr className="border-slate-200" />

          {/* OpenSpec Handoff */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-sm font-bold text-slate-900">
                OpenSpec 提案交接
              </h3>
              {!openspecInitialized && (
                <span className="text-xs font-medium text-amber-700">
                  OpenSpec 未初始化
                </span>
              )}
            </div>

            {/* Archive flowback prompt */}
            {evaluated.readyToConfirmComplete && (
              <div className="rounded-md border border-emerald-200 bg-emerald-50/70 p-3 text-xs space-y-2">
                <div className="flex items-center gap-1.5 font-semibold text-emerald-900">
                  <CheckCircle2 className="h-4 w-4 text-emerald-700" />
                  <span>关联提案已归档，是否确认完成？</span>
                </div>
                <p className="text-emerald-800">
                  所有关联的 OpenSpec 提案均已归档。确认后将关闭此需求并记录为“已完成”；你也可以先保持打开，稍后再确认。
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void runAction(() => onConfirmComplete(issue.id))}
                    className="rounded bg-emerald-700 px-3 py-1.5 font-medium text-white hover:bg-emerald-800"
                  >
                    确认完成并关闭
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeferredConfirmNote(true)}
                    className="rounded border border-emerald-300 bg-white px-3 py-1.5 font-medium text-emerald-900 hover:bg-emerald-50"
                  >
                    先不关闭
                  </button>
                </div>
                {deferredConfirmNote && (
                  <p className="text-emerald-700">已为你保持需求打开，后续可随时在此确认完成。</p>
                )}
              </div>
            )}

            {/* Snapshot diff alert */}
            {evaluated.hasSnapshotDiff && (
              <div className="rounded-md border border-amber-200 bg-amber-50/70 px-3 py-2 text-xs text-amber-900">
                <strong>创建提案后需求内容有更新：</strong>
                需求标题或描述已不同于建立关联时的版本。为避免覆盖已有设计，系统不会自动改写提案，请按需在 OpenSpec 中同步。
              </div>
            )}

            {/* Existing proposal links */}
            {evaluated.proposalStatuses.length > 0 && (
              <ul className="space-y-2">
                {evaluated.proposalStatuses.map((p) => (
                  <li
                    key={p.id}
                    className="rounded-md border border-slate-200 px-3 py-2.5 text-xs space-y-1.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 font-mono font-semibold text-slate-900">
                        {p.state === 'missing' ? (
                          <Link2Off className="h-3.5 w-3.5 text-red-700" />
                        ) : (
                          <Link2 className="h-3.5 w-3.5 text-blue-700" />
                        )}
                        <span>{p.id}</span>
                      </div>
                      <span
                        className={`font-medium ${
                          p.state === 'missing'
                            ? 'text-red-700'
                            : p.state === 'archived'
                              ? 'text-emerald-700'
                              : 'text-blue-700'
                        }`}
                      >
                        {p.state === 'active'
                          ? `进行中${p.tasks ? ` · 已完成任务 ${p.tasks.done}/${p.tasks.total}` : ''}`
                          : p.state === 'archived'
                            ? `已归档 · ${formatShortDate(p.archived_at)}`
                            : '关联已失效（未在活跃或归档目录中找到）'}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2 text-slate-500">
                      <span className="font-mono">{p.path}</span>
                      {p.state !== 'missing' && (
                        <span>已双向关联（已写入 x-openissue-issues）</span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-[11px] text-slate-400">
                      {p.created_at ? <span>关联于 {formatShortDate(p.created_at)}</span> : null}
                      {p.snapshot_hash ? <span>快照 {p.snapshot_hash.slice(0, 12)}</span> : null}
                      {p.interviewIncomplete ? (
                        <span className="font-sans font-medium text-amber-700">访谈未完成</span>
                      ) : null}
                      {p.interviewCompleted ? (
                        <span className="font-sans font-medium text-emerald-700">访谈已完成</span>
                      ) : null}
                      {p.interviewUnknown ? (
                        <span className="font-sans font-medium text-amber-700">访谈状态未知</span>
                      ) : null}
                      {p.hasSnapshotDiff ? (
                        <span className="font-sans font-medium text-amber-700">需求已更新</span>
                      ) : null}
                    </div>

                    {p.state === 'missing' && (
                      <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-2">
                        {relinkMissingId === p.id ? (
                          <>
                            <select
                              value={selectedExistingChange}
                              onChange={(e) => setSelectedExistingChange(e.target.value)}
                              className="flex-1 rounded border border-slate-200 px-2 py-1 text-xs"
                            >
                              {activeChanges.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.id} — {c.title}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              disabled={!selectedExistingChange}
                              onClick={() =>
                                void runAction(async () => {
                                  await onLinkProposal(issue.id, selectedExistingChange);
                                  setRelinkMissingId(null);
                                })
                              }
                              className="rounded bg-slate-900 px-2.5 py-1 text-white"
                            >
                              确认重新关联
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => setRelinkMissingId(p.id)}
                              className="rounded border border-slate-300 px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-50"
                            >
                              重新关联提案
                            </button>
                            <button
                              type="button"
                              onClick={() => setShowCloseForm(true)}
                              className="rounded border border-slate-300 px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-50"
                            >
                              关闭此需求
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {/* Interview entry and existing proposal linking */}
            <div className="space-y-2.5">
              {startContext ? (
                <div
                  data-testid="start-entry"
                  className="space-y-2.5 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 font-semibold text-slate-800">
                      <ArrowRight className="h-3.5 w-3.5" />
                      产品决策访谈入口
                    </div>
                    <button
                      type="button"
                      onClick={handleCopyStart}
                      className="inline-flex items-center gap-1 rounded px-2 py-0.5 font-medium text-slate-700 hover:bg-slate-200/70"
                    >
                      {copiedStart ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                      {copiedStart ? '已复制' : '复制上下文'}
                    </button>
                  </div>
                  <p className="leading-relaxed text-slate-600">
                    将需求、当前重点与关联提案上下文交给外部助手，由
                    <code className="mx-1 font-mono">openissue-grill-me</code>
                    推进产品决策访谈。看板不会自动创建或改写提案。
                  </p>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <div className="rounded border border-slate-200 bg-white px-2.5 py-2">
                      <div className="text-slate-500">建议变更标识</div>
                      <div className="mt-0.5 font-mono text-slate-900">
                        {startContext.suggested_change_id}
                      </div>
                    </div>
                    <div className="rounded border border-slate-200 bg-white px-2.5 py-2">
                      <div className="text-slate-500">访谈状态</div>
                      <div className="mt-0.5 font-medium text-slate-900">
                        {startContext.interview.status === 'incomplete'
                          ? '存在未完成草稿'
                          : startContext.interview.status === 'completed'
                            ? '已完成'
                            : startContext.interview.status === 'unknown'
                              ? '状态未知'
                              : '尚未开始'}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-slate-500">
                    <span>活跃提案 {startContext.active_proposals.length}</span>
                    <span>已归档 {startContext.archived_proposals.length}</span>
                    <span>关联失效 {startContext.missing_proposals.length}</span>
                    {startContext.resume_change_id ? (
                      <span className="font-mono">继续 {startContext.resume_change_id}</span>
                    ) : null}
                  </div>
                  {!startContext.skill_available ? (
                    <p className="rounded border border-amber-200 bg-amber-50 px-2.5 py-2 font-medium text-amber-900">
                      当前仓库未安装 openissue-grill-me。请先运行
                      <code className="mx-1 font-mono">
                        openissue skills install --tool agents
                      </code>
                      。
                    </p>
                  ) : null}
                  <pre
                    data-testid="start-context"
                    className="max-h-64 overflow-auto whitespace-pre-wrap rounded border border-slate-200 bg-white p-2.5 font-mono text-[11px] leading-relaxed text-slate-600"
                  >
                    {startContext.instruction}
                  </pre>
                </div>
              ) : (
                <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
                  当前需求没有可用的访谈上下文；请刷新后重试。
                </p>
              )}

              {activeChanges.length > 0 ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  <label htmlFor="existing-change-select" className="text-xs text-slate-500">
                    关联已有活跃提案
                  </label>
                  <select
                    id="existing-change-select"
                    aria-label="选择已有活跃提案"
                    value={selectedExistingChange}
                    onChange={(event) => setSelectedExistingChange(event.target.value)}
                    className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700"
                  >
                    {activeChanges.map((change) => (
                      <option key={change.id} value={change.id}>
                        {change.id}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={!selectedExistingChange}
                    onClick={() =>
                      void runAction(() => onLinkProposal(issue.id, selectedExistingChange))
                    }
                    className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-40"
                  >
                    关联已有提案
                  </button>
                </div>
              ) : null}
            </div>
          </section>

          <hr className="border-slate-200" />

          {/* Lifecycle (Close / Reopen — never permanent delete) */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-sm font-bold text-slate-900">
                需求状态管理
              </h3>
              <span className="text-xs text-slate-500">
                关闭后仍保留完整记录，可随时重新打开
              </span>
            </div>

            {issue.close_reason && (
              <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                上次关闭原因：
                <strong className="ml-1">
                  {issue.close_reason === 'completed' ? '已完成' : '不做'}
                </strong>
                {issue.close_note && <span className="ml-1.5">（{issue.close_note}）</span>}
                {issue.status === 'open' && (
                  <span className="ml-2 text-slate-500">· 重新打开后仍保留该记录</span>
                )}
              </div>
            )}

            {issue.status === 'closed' ? (
              <button
                type="button"
                onClick={() => void runAction(() => onReopenIssue(issue.id))}
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-900 hover:bg-slate-50"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                重新打开
              </button>
            ) : !showCloseForm ? (
              <button
                type="button"
                onClick={() => setShowCloseForm(true)}
                className="rounded-md border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50"
              >
                关闭需求
              </button>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void runAction(async () => {
                    await onCloseIssue(
                      issue.id,
                      closeReason === '' ? undefined : closeReason,
                      closeNote
                    );
                    setShowCloseForm(false);
                  });
                }}
                className="rounded-md border border-slate-200 bg-slate-50 p-3.5 space-y-3 text-xs"
              >
                {hasActiveProposal && (
                  <p className="rounded border border-blue-200 bg-blue-50 px-2.5 py-2 font-medium text-blue-900">
                    当前需求仍关联着进行中的 OpenSpec 提案。关闭需求不会取消或改动提案本身，确认要关闭吗？
                  </p>
                )}

                <div className="space-y-2">
                  <div className="font-semibold text-slate-800">请选择关闭原因：</div>
                  <div className="flex items-center gap-4">
                    <label className="inline-flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="radio"
                        name="close-reason"
                        value="completed"
                        checked={closeReason === 'completed'}
                        onChange={() => setCloseReason('completed')}
                      />
                      <span>已完成</span>
                    </label>
                    <label className="inline-flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="radio"
                        name="close-reason"
                        value="wont_do"
                        checked={closeReason === 'wont_do'}
                        onChange={() => setCloseReason('wont_do')}
                      />
                      <span>不做</span>
                    </label>
                  </div>
                </div>

                {closeReason === 'wont_do' && (
                  <div>
                    <label htmlFor="close-note-input" className="block font-medium text-slate-700 mb-1">
                      请简述“不做”的原因：
                    </label>
                    <input
                      id="close-note-input"
                      type="text"
                      value={closeNote}
                      onChange={(e) => setCloseNote(e.target.value)}
                      placeholder="例如：超出当前阶段范围，暂不实现"
                      className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900"
                    />
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <button
                    type="submit"
                    className="rounded bg-slate-900 px-3.5 py-1.5 font-medium text-white hover:bg-slate-800"
                  >
                    确认关闭
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowCloseForm(false);
                      setErrorMsg(null);
                    }}
                    className="rounded px-3 py-1.5 text-slate-600 hover:bg-slate-200/70"
                  >
                    取消
                  </button>
                </div>
              </form>
            )}
          </section>

          <details className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
            <summary className="cursor-pointer font-medium text-slate-700">
              查看完整字段（frontmatter / 派生字段）
            </summary>
            <CustomScrollArea
              autoHeight
              direction="both"
              tone="dark"
              className="mt-2 rounded bg-slate-950"
              viewportClassName="max-h-72 p-3"
            >
              <pre className="w-max min-w-full font-mono text-[11px] leading-relaxed text-slate-100">
                {JSON.stringify(
                  {
                    frontmatter: issue.rawFrontmatter,
                    derived: {
                      id: issue.id,
                      product_id: issue.product_id,
                      status: issue.status,
                      close: issue.close,
                      filePath: issue.filePath,
                      priority: issue.priority,
                      blocked_by: issue.blocked_by,
                      proposals: issue.proposals,
                      effectiveTier: evaluated.effectiveTier,
                      precedenceStage: evaluated.precedenceStage,
                      reason: evaluated.reason,
                      basis: evaluated.basis,
                      isManual: evaluated.isManual,
                      manualOverriddenByRule: evaluated.manualOverriddenByRule,
                      isStale: evaluated.isStale,
                      dependencyFloor: evaluated.dependencyFloor,
                      invalidDependency: evaluated.invalidDependency,
                      invalidReason: evaluated.invalidReason,
                      blocked: evaluated.isBlocked,
                      blockedReason: evaluated.blockedReason,
                      hasAbandonedUpstream: evaluated.hasAbandonedUpstream,
                      hasUnknownUpstream: evaluated.hasUnknownUpstream,
                      dependencyDepth: evaluated.dependencyDepth,
                      sortRank: evaluated.sortRank,
                      currentInputHash: evaluated.currentInputHash,
                      judgedAt: evaluated.judgedAt,
                      upstreamDeps: evaluated.upstreamDeps,
                      downstreamDeps: evaluated.downstreamDeps,
                      proposalStatuses: evaluated.proposalStatuses,
                      readyToConfirmComplete: evaluated.readyToConfirmComplete,
                      hasBrokenProposalLink: evaluated.hasBrokenProposalLink,
                      hasSnapshotDiff: evaluated.hasSnapshotDiff,
                      startContext: evaluated.startContext,
                    },
                  },
                  null,
                  2,
                )}
              </pre>
            </CustomScrollArea>
          </details>

          {/* Raw Git-Native Markdown */}
          {issue.rawMarkdown && (
            <details className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
              <summary className="cursor-pointer font-medium text-slate-700">
                查看原始 Markdown 文件（{issue.filePath}）
              </summary>
              <CustomScrollArea
                autoHeight
                direction="both"
                tone="dark"
                className="mt-2 rounded bg-slate-950"
                viewportClassName="max-h-64 p-3"
              >
                <pre className="font-mono text-[11px] leading-relaxed text-slate-100 w-max min-w-full">
                  {issue.rawMarkdown}
                </pre>
              </CustomScrollArea>
            </details>
          )}
        </CustomScrollArea>
      </aside>
    </div>
  );
};
