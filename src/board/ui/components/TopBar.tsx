import React from 'react';

export type MainTab = 'board' | 'dependencies' | 'openspec' | 'workspace';

interface TopBarProps {
  activeTab: MainTab;
  onSelectTab: (tab: MainTab) => void;
  onOpenPrioritize: () => void;
  disabledActions?: boolean;
}

const NAV_ITEMS: Array<{ id: MainTab; label: string }> = [
  { id: 'board', label: '优先级看板' },
  { id: 'dependencies', label: '依赖关系' },
  { id: 'openspec', label: 'OpenSpec 交接' },
  { id: 'workspace', label: '仓库与文件' },
];

export const TopBar: React.FC<TopBarProps> = ({
  activeTab,
  onSelectTab,
  onOpenPrioritize,
  disabledActions,
}) => {
  return (
    <header className="shrink-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur-sm">
      <div className="flex w-full items-center justify-between gap-4 md:gap-8 px-4 sm:px-6 py-3.5">
        {/* Zone 1: Single-element brand wordmark */}
        <a
          href="#board"
          onClick={(e) => {
            e.preventDefault();
            onSelectTab('board');
          }}
          className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 rounded"
        >
          OpenIssue
        </a>

        {/* Zone 2: 4 single-line text nav links (desktop/tablet) + compact select (mobile, zero scrollbar) */}
        <nav aria-label="主导航" className="flex items-center">
          <div className="hidden md:flex items-center gap-6 text-sm font-medium">
            {NAV_ITEMS.map((item) => {
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelectTab(item.id)}
                  aria-current={isActive ? 'page' : undefined}
                  className={`relative py-1 whitespace-nowrap shrink-0 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 rounded ${
                    isActive
                      ? 'text-slate-900 font-semibold'
                      : 'text-slate-500 hover:text-slate-900'
                  }`}
                >
                  {item.label}
                  {isActive && (
                    <span
                      aria-hidden="true"
                      className="absolute inset-x-0 -bottom-[15px] h-0.5 bg-slate-900"
                    />
                  )}
                </button>
              );
            })}
          </div>

          <div className="md:hidden">
            <label htmlFor="mobile-nav-select" className="sr-only">
              切换视图
            </label>
            <select
              id="mobile-nav-select"
              value={activeTab}
              onChange={(e) => onSelectTab(e.target.value as MainTab)}
              className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-semibold text-slate-900 focus:border-slate-900 focus:outline-none"
            >
              {NAV_ITEMS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>
        </nav>

        {/* Zone 3: 1 primary CTA */}
        <div className="flex items-center shrink-0">
          <button
            type="button"
            disabled={disabledActions}
            onClick={onOpenPrioritize}
            className="px-3 sm:px-4 py-2 text-xs font-semibold text-white bg-slate-900 rounded-md hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-150 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2"
          >
            助手语义判断
          </button>
        </div>
      </div>
    </header>
  );
};
