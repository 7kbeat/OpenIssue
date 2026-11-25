import React, { useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react';
import type { ConflictRecord } from '../../types.js';
import { CustomScrollArea } from './CustomScrollArea';

interface ConflictZoneProps {
  conflicts: ConflictRecord[];
}

export const ConflictZone: React.FC<ConflictZoneProps> = ({ conflicts }) => {
  const [panelOpen, setPanelOpen] = useState(false);
  const [expandedRawIds, setExpandedRawIds] = useState<Record<string, boolean>>({});

  if (conflicts.length === 0) return null;

  const toggleRaw = (id: string) => {
    setExpandedRawIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <section
      aria-label="需要处理的冲突记录"
      data-testid="conflicts"
      className="shrink-0 rounded-lg border border-red-200 bg-red-50/70 px-4 py-2.5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-xs text-red-900">
          <AlertTriangle className="h-4 w-4 text-red-700 shrink-0" />
          <span className="font-semibold">
            发现 {conflicts.length} 个存在冲突或格式异常的需求文件
          </span>
          <span aria-hidden="true" className="text-red-300">
            ·
          </span>
          <span className="font-mono text-red-800">
            {conflicts.map((c) => c.id).join(', ')}
          </span>
        </div>

        <button
          type="button"
          onClick={() => setPanelOpen((v) => !v)}
          aria-expanded={panelOpen}
          className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-red-800 hover:bg-red-100/70 whitespace-nowrap"
        >
          {panelOpen ? (
            <>
              <ChevronDown className="h-3.5 w-3.5" />
              收起详情
            </>
          ) : (
            <>
              <ChevronRight className="h-3.5 w-3.5" />
              查看详情与原文
            </>
          )}
        </button>
      </div>

      {panelOpen && (
        <CustomScrollArea
          autoHeight
          className="mt-2.5 border-t border-red-200/70 pt-2.5"
          viewportClassName="max-h-56 space-y-2 pr-2"
        >
          <p className="text-xs text-red-800">
            请先在本地仓库中解决冲突或修复文件格式，系统已完整保留原始内容以便对照处理。
          </p>
          {conflicts.map((c) => {
            const isRawOpen = Boolean(expandedRawIds[c.id]);
            return (
              <div
                key={c.filePath}
                data-testid="conflict-item"
                className="rounded-md border border-red-200 bg-white px-3.5 py-2.5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                    <span className="font-mono font-semibold text-red-900">{c.id}</span>
                    <span aria-hidden="true" className="text-slate-300">
                      ·
                    </span>
                    <span className="font-mono text-slate-600">{c.filePath}</span>
                    <span aria-hidden="true" className="text-slate-300">
                      ·
                    </span>
                    <span className="font-medium text-red-700">{c.error}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => toggleRaw(c.id)}
                    aria-expanded={isRawOpen}
                    className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 whitespace-nowrap"
                  >
                    {isRawOpen ? (
                      <>
                        <ChevronDown className="h-3.5 w-3.5" />
                        收起原文
                      </>
                    ) : (
                      <>
                        <ChevronRight className="h-3.5 w-3.5" />
                        查看原文
                      </>
                    )}
                  </button>
                </div>
                {isRawOpen && (
                  <CustomScrollArea
                    autoHeight
                    direction="both"
                    tone="dark"
                    className="mt-2.5 rounded border border-slate-200 bg-slate-950"
                    viewportClassName="max-h-60 p-3"
                  >
                    <pre
                      data-testid="conflict-raw"
                      className="font-mono text-xs leading-relaxed text-slate-100"
                    >
                      {c.rawContent}
                    </pre>
                  </CustomScrollArea>
                )}
              </div>
            );
          })}
        </CustomScrollArea>
      )}
    </section>
  );
};
