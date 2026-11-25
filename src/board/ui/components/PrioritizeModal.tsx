import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Copy, Play, X } from 'lucide-react';
import { api } from '../api/client.js';
import type {
  AssistantRequest,
  AssistantRequestIssue,
  PrioritizeApplyResult,
} from '../../types.js';
import {
  CustomScrollArea,
  CustomScrollTracks,
  useCustomScrollbar,
} from './CustomScrollArea.js';

interface PrioritizeModalProps {
  open: boolean;
  onClose: () => void;
  onApplied: () => Promise<void>;
}

export function PrioritizeModal({ open, onClose, onApplied }: PrioritizeModalProps) {
  const [request, setRequest] = useState<AssistantRequest | null>(null);
  const [applyJson, setApplyJson] = useState('');
  const [applyResult, setApplyResult] = useState<PrioritizeApplyResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [textareaHovered, setTextareaHovered] = useState(false);

  const textareaScroll = useCustomScrollbar<HTMLTextAreaElement>({
    direction: 'both',
    enabled: open,
    contentKey: applyJson,
  });

  useEffect(() => {
    if (!open) return;
    setErrorMsg(null);
    setApplyResult(null);
    setLoading(true);
    api
      .emitPrioritize()
      .then((payload) => {
        setRequest(payload);
        setApplyJson(JSON.stringify(buildSample(payload), null, 2));
      })
      .catch((error) => {
        setErrorMsg(error instanceof Error ? error.message : String(error));
      })
      .finally(() => setLoading(false));
  }, [open]);

  if (!open) return null;

  const handleApply = async () => {
    setErrorMsg(null);
    setApplyResult(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(applyJson);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setErrorMsg(`JSON 格式不正确，请检查后再试（${detail}）`);
      return;
    }
    const results =
      Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === 'object' && 'results' in parsed
          ? parsed.results
          : null;
    if (!Array.isArray(results)) {
      setErrorMsg('判断结果应为 results 数组，或直接提供结果数组');
      return;
    }
    try {
      const response = await api.applyPrioritize(results);
      setApplyResult(response.result);
      await onApplied();
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : String(error));
    }
  };

  const handleCopyRequest = () => {
    if (!request) return;
    void navigator.clipboard?.writeText(JSON.stringify(request, null, 2)).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/35 p-4 backdrop-blur-[1px]">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="助手语义判断 emit 与 apply 控制台"
        className="flex max-h-[90vh] w-full max-w-5xl flex-col rounded-lg border border-slate-200 bg-white shadow-2xl"
      >
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 px-6 py-4">
          <div>
            <h2 className="font-display text-base font-bold text-slate-900">
              助手语义判断（priority --emit / --apply）
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              构造包含当前重点与真实项目事实的判断请求，粘贴外部助手返回的有效结果后写回。不需要配置模型账号或密钥。
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭助手语义判断窗口"
            className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-900"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <CustomScrollArea
          className="flex-1 min-h-0"
          viewportClassName="grid grid-cols-1 gap-5 p-6 pr-7 lg:grid-cols-2"
        >
          <div className="flex min-w-0 flex-col space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="font-semibold text-slate-800">
                1. 待评估数据（openissue priority --emit）
              </span>
              <button
                type="button"
                onClick={handleCopyRequest}
                className="inline-flex items-center gap-1 text-slate-600 underline decoration-slate-300 hover:text-slate-900"
              >
                <Copy className="h-3 w-3" />
                {copied ? '已复制' : '复制请求'}
              </button>
            </div>
            {request ? (
              <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-500">
                <span>请求哈希：{request.request_hash.slice(0, 16)}…</span>
                <span className="text-right">
                  待判断 {request.issues.filter((issue) => issue.needs_judgment).length} 条
                </span>
              </div>
            ) : null}
            <CustomScrollArea
              autoHeight
              direction="both"
              tone="dark"
              className="flex-1 rounded-md border border-slate-200 bg-slate-950"
              viewportClassName="max-h-[420px] p-3.5"
            >
              <pre className="w-max min-w-full font-mono text-[11px] leading-relaxed text-slate-100">
                {loading
                  ? '正在整理待评估数据，请稍候……'
                  : JSON.stringify(request, null, 2)}
              </pre>
            </CustomScrollArea>
          </div>

          <div className="flex min-w-0 flex-col space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-800">
                2. 写回判断结果（openissue priority --apply）
              </span>
              <button
                type="button"
                onClick={() => setApplyJson(JSON.stringify(buildSample(request), null, 2))}
                className="font-medium text-slate-600 underline decoration-slate-300 hover:text-slate-900"
              >
                载入示例结果
              </button>
            </div>
            <label htmlFor="apply-json-textarea" className="sr-only">
              助手判断结果 JSON
            </label>
            <div
              onMouseEnter={() => setTextareaHovered(true)}
              onMouseLeave={() => setTextareaHovered(false)}
              className="relative flex min-h-0 flex-1 flex-col rounded-md border border-slate-300 bg-white focus-within:border-slate-900"
            >
              <textarea
                ref={textareaScroll.viewportRef}
                id="apply-json-textarea"
                value={applyJson}
                onChange={(event) => setApplyJson(event.target.value)}
                spellCheck={false}
                rows={15}
                className="no-native-scrollbar min-h-0 w-full flex-1 resize-none rounded-md bg-transparent p-3 pr-4 font-mono text-xs leading-relaxed text-slate-900 focus:outline-none"
              />
              <CustomScrollTracks
                controller={textareaScroll}
                tone="light"
                isHovered={textareaHovered}
              />
            </div>

            {errorMsg ? (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-700" />
                <span>{errorMsg}</span>
              </div>
            ) : null}

            {applyResult ? (
              <div className="space-y-1.5 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs">
                <div className="flex items-center gap-1.5 font-semibold text-emerald-800">
                  <CheckCircle2 className="h-4 w-4 text-emerald-700" />
                  <span>
                    已更新 {applyResult.applied.length} 条需求：
                    {applyResult.applied.join(', ') || '无'}
                  </span>
                </div>
                {applyResult.errors.length > 0 ? (
                  <div className="space-y-1 text-red-700">
                    <div className="font-semibold">
                      已跳过 {applyResult.errors.length} 条未通过校验的记录：
                    </div>
                    <ul className="list-disc space-y-0.5 pl-4">
                      {applyResult.errors.map((error) => (
                        <li key={error}>{error}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </CustomScrollArea>

        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-slate-200 px-6 py-3.5">
          <span className="text-xs text-slate-500">
            已有手动档位的需求会保留你的设定；即使外部助手不可用，依赖与规则判断仍会正常生效。
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-slate-200 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              关闭
            </button>
            <button
              type="button"
              onClick={() => void handleApply()}
              className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800"
            >
              <Play className="h-3.5 w-3.5" />
              校验并应用结果
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function buildSample(request: AssistantRequest | null): unknown[] {
  if (!request) return [];
  const samples: unknown[] = [];
  for (const issue of request.issues.filter((item) => item.needs_judgment)) {
    const basis = firstBasis(issue, request.focus);
    if (!basis) continue;
    samples.push({
      id: issue.id,
      tier:
        issue.effective_tier === 'high' ||
        issue.effective_tier === 'medium' ||
        issue.effective_tier === 'low'
          ? issue.effective_tier
          : 'medium',
      reason: `结合${basis === 'focus' ? '当前重点' : '项目事实'}保持可解释判断`,
      basis: [basis],
      input_hash: issue.input_hash,
    });
    if (samples.length === 2) break;
  }
  return samples;
}

function firstBasis(issue: AssistantRequestIssue, focus: string): string | undefined {
  if (focus.trim()) return 'focus';
  const proposal = issue.proposals.find((item) => item.state !== 'missing');
  if (proposal) return `proposal:${proposal.id}`;
  const dependency = issue.blocked_by[0];
  if (dependency) return `dependency:${dependency}`;
  return undefined;
}
