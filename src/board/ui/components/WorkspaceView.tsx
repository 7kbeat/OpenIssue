import { useState } from 'react';
import { FileCode2, FolderGit2, GitFork, Layers3, Link2 } from 'lucide-react';
import type { BoardSnapshot } from '../../types.js';
import { CustomScrollArea, useMediaQuery } from './CustomScrollArea.js';

interface WorkspaceViewProps {
  snapshot: BoardSnapshot;
}

export function WorkspaceView({ snapshot }: WorkspaceViewProps) {
  const [selectedFile, setSelectedFile] = useState(snapshot.files[0]?.path ?? '');
  const isLg = useMediaQuery('(min-width: 1024px)');
  const { workspace, product } = snapshot;
  const activeFile =
    snapshot.files.find((file) => file.path === selectedFile) ?? snapshot.files[0];

  return (
    <CustomScrollArea
      enabled={!isLg}
      className="flex-1 min-h-0 lg:flex lg:flex-col lg:gap-4 lg:overflow-hidden"
      viewportClassName="space-y-4 pr-2"
    >
      <section className="shrink-0 space-y-4 rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div>
            <h2 className="font-display text-base font-bold text-slate-900">
              工作区识别与仓库边界
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              当前看板已经解析到唯一产品锚点；需求只保存在锚点仓库，成员仓库仅保留指针。
            </p>
          </div>
          <span className="rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 font-mono text-xs text-slate-600">
            {workspace.mode === 'anchor' ? '锚点仓库入口' : '成员仓库入口'}
          </span>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <InfoCard
            icon={<FolderGit2 className="h-3.5 w-3.5" />}
            title="当前仓库"
            value={workspace.currentRepoName}
            detail={workspace.currentRepoPath}
          />
          <InfoCard
            icon={<Layers3 className="h-3.5 w-3.5" />}
            title="产品"
            value={product.name}
            detail={`${product.id} · ${product.anchor_repo}`}
          />
          <InfoCard
            icon={<GitFork className="h-3.5 w-3.5" />}
            title="唯一数据源"
            value="锚点 openissue/"
            detail={workspace.anchorRoot}
          />
          <InfoCard
            icon={<Link2 className="h-3.5 w-3.5" />}
            title="能力状态"
            value={workspace.openspecInitialized ? 'OpenSpec 已初始化' : 'OpenSpec 未初始化'}
            detail={`${workspace.skillAvailable ? 'grill-me 已安装' : 'grill-me 未安装'} · ${
              snapshot.files.length
            } 个文件`}
          />
        </div>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <div className="rounded-md border border-slate-200 bg-slate-50/60 p-4">
            <div className="text-xs font-semibold text-slate-700">当前重点</div>
            <p className="mt-1.5 text-sm font-medium text-slate-900">
              {product.focus?.text || '尚未设置'}
            </p>
            <p className="mt-1 font-mono text-[11px] text-slate-400">
              {product.focus?.updated_at || '—'}
            </p>
          </div>
          <div className="rounded-md border border-slate-200 bg-slate-50/60 p-4">
            <div className="text-xs font-semibold text-slate-700">成员仓库</div>
            {product.members.length === 0 ? (
              <p className="mt-1.5 text-sm text-slate-500">尚未登记成员仓库</p>
            ) : (
              <ul className="mt-1.5 space-y-1 text-xs text-slate-600">
                {product.members.map((member) => (
                  <li key={member.id} className="flex flex-wrap gap-x-2">
                    <span className="font-mono text-slate-800">{member.id}</span>
                    <span>{member.name ?? '—'}</span>
                    {member.path ? (
                      <span className="font-mono text-slate-400">{member.path}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <details className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
          <summary className="cursor-pointer font-medium text-slate-700">
            查看完整工作区与产品字段
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
                  workspace,
                  product,
                  facts: {
                    openspecInitialized: snapshot.facts.openspecInitialized,
                    specs: snapshot.facts.specs,
                    activeChanges: snapshot.facts.activeChanges,
                    archivedChanges: snapshot.facts.archivedChanges,
                  },
                },
                null,
                2,
              )}
            </pre>
          </CustomScrollArea>
        </details>
      </section>

      <section className="flex shrink-0 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white lg:flex-1 lg:min-h-0">
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-5 py-3.5">
          <div>
            <h3 className="font-display text-sm font-bold text-slate-900">
              Git 原生文件（唯一数据源）
            </h3>
            <p className="text-xs text-slate-500">
              需求、产品清单、OpenSpec 提案与规范均来自本地文件。
            </p>
          </div>
          <span className="font-mono text-xs text-slate-500 tabular-nums">
            {snapshot.files.length} 个文件
          </span>
        </div>

        <div className="grid grid-cols-1 overflow-hidden lg:flex-1 lg:min-h-0 lg:grid-cols-12">
          <CustomScrollArea
            autoHeight={!isLg}
            className="border-b border-slate-200 lg:col-span-4 lg:h-full lg:min-h-0 lg:border-b-0 lg:border-r"
            viewportClassName="max-h-72 divide-y divide-slate-100 pr-2 lg:max-h-none"
          >
            {snapshot.files.map((file) => {
              const selected = activeFile?.path === file.path;
              return (
                <button
                  key={file.path}
                  type="button"
                  onClick={() => setSelectedFile(file.path)}
                  className={`flex w-full items-center gap-2 px-4 py-2.5 text-left font-mono text-xs transition-colors ${
                    selected
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <FileCode2 className="h-3.5 w-3.5 shrink-0 opacity-75" />
                  <span className="truncate">{file.path}</span>
                </button>
              );
            })}
          </CustomScrollArea>

          <CustomScrollArea
            direction="both"
            tone="dark"
            autoHeight={!isLg}
            className="bg-slate-950 lg:col-span-8 lg:h-full lg:min-h-0"
            viewportClassName="max-h-96 p-4 lg:max-h-none"
          >
            {activeFile ? (
              <pre className="w-max min-w-full font-mono text-xs leading-relaxed text-slate-100">
                {activeFile.content}
              </pre>
            ) : (
              <p className="text-xs text-slate-400">请在左侧选择要查看的文件</p>
            )}
          </CustomScrollArea>
        </div>
      </section>
    </CustomScrollArea>
  );
}

function InfoCard({
  icon,
  title,
  value,
  detail,
}: {
  icon: React.ReactNode;
  title: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-md border border-slate-200 bg-white p-3.5">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500">
        {icon}
        <span>{title}</span>
      </div>
      <div className="mt-1.5 truncate text-sm font-semibold text-slate-900">{value}</div>
      <div className="mt-0.5 truncate font-mono text-[11px] text-slate-400" title={detail}>
        {detail}
      </div>
    </div>
  );
}
