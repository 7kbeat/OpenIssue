import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { api } from './api/client.js';
import { ConflictZone } from './components/ConflictZone.js';
import { CustomScrollArea } from './components/CustomScrollArea.js';
import { DependencyView } from './components/DependencyView.js';
import { IssueInspectorDrawer } from './components/IssueInspectorDrawer.js';
import { OpenSpecView } from './components/OpenSpecView.js';
import { PrioritizeModal } from './components/PrioritizeModal.js';
import { PriorityBoard } from './components/PriorityBoard.js';
import { TopBar, type MainTab } from './components/TopBar.js';
import { WorkspaceToolbar, type BoardLayoutMode } from './components/WorkspaceToolbar.js';
import { WorkspaceView } from './components/WorkspaceView.js';
import { DEFAULT_SEARCH_FILTER, filterEvaluatedIssues } from './domain/search.js';
import type { BoardSnapshot, SearchFilterState } from '../types.js';

export function App() {
  const [snapshot, setSnapshot] = useState<BoardSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<MainTab>('board');
  const [layoutMode, setLayoutMode] = useState<BoardLayoutMode>('columns');
  const [filter, setFilter] = useState<SearchFilterState>(DEFAULT_SEARCH_FILTER);
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);
  const [prioritizeOpen, setPrioritizeOpen] = useState(false);

  const fetchState = useCallback(async () => {
    try {
      setLoadError(null);
      setSnapshot(await api.getState());
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchState();
  }, [fetchState]);

  const runMutation = async (
    fn: () => Promise<BoardSnapshot>,
    options?: { localAlert?: boolean },
  ): Promise<void> => {
    setActionError(null);
    try {
      setSnapshot(await fn());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!options?.localAlert) setActionError(message);
      throw error;
    }
  };

  const filteredEvaluated = useMemo(() => {
    if (!snapshot) return [];
    return filterEvaluatedIssues(snapshot.evaluated, filter);
  }, [snapshot, filter]);

  const selectedEvaluated = useMemo(() => {
    if (!snapshot || !selectedIssueId) return null;
    return snapshot.evaluated.find((item) => item.issue.id === selectedIssueId) ?? null;
  }, [snapshot, selectedIssueId]);

  const staleCount = useMemo(
    () => snapshot?.evaluated.filter((item) => item.isStale).length ?? 0,
    [snapshot],
  );

  return (
    <div className="flex h-dvh w-full flex-col overflow-hidden bg-slate-50 text-slate-900">
      <TopBar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        onOpenPrioritize={() => setPrioritizeOpen(true)}
        disabledActions={!snapshot}
      />

      {loading ? (
        <CustomScrollArea
          as="main"
          ariaBusy
          className="w-full flex-1 min-h-0"
          viewportClassName="px-4 sm:px-6 py-8"
        >
          <p className="sr-only">正在加载看板数据，请稍候……</p>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-5">
            {[0, 1, 2, 3].map((index) => (
              <div
                key={index}
                className="h-80 animate-pulse rounded-lg border border-slate-200 bg-white p-4"
              />
            ))}
          </div>
        </CustomScrollArea>
      ) : null}

      {!loading && loadError ? (
        <CustomScrollArea
          as="main"
          className="w-full flex-1 min-h-0"
          viewportClassName="px-6 py-12"
        >
          <div className="mx-auto w-full max-w-2xl">
            <div
              role="alert"
              className="space-y-3 rounded-lg border border-red-200 bg-white p-6"
            >
              <div className="flex items-center gap-2 text-sm font-semibold text-red-800">
                <AlertCircle className="h-4 w-4" />
                <span>暂时无法加载看板数据</span>
              </div>
              <p className="text-sm text-slate-600">
                {loadError}。请确认本地服务正常运行后重试。
              </p>
              <button
                type="button"
                onClick={() => void fetchState()}
                className="rounded-md bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800"
              >
                重新加载
              </button>
            </div>
          </div>
        </CustomScrollArea>
      ) : null}

      {!loading && snapshot ? (
        <>
          {activeTab === 'board' ? (
            <WorkspaceToolbar
              workspace={snapshot.workspace}
              product={snapshot.product}
              facts={snapshot.facts}
              filter={filter}
              onChangeFilter={setFilter}
              onResetFilter={() => setFilter(DEFAULT_SEARCH_FILTER)}
              layoutMode={layoutMode}
              onChangeLayoutMode={setLayoutMode}
              onSaveFocus={(text) => runMutation(() => api.updateFocus(text))}
              staleCount={staleCount}
            />
          ) : null}

          <main className="flex w-full flex-1 min-h-0 flex-col gap-4 overflow-hidden px-4 py-4 sm:px-6 sm:py-5">
            {actionError ? (
              <div
                role="alert"
                className="flex shrink-0 items-center justify-between gap-3 rounded-md border border-red-200 bg-red-50 px-4 py-2.5 text-xs font-medium text-red-800"
              >
                <span>{actionError}</span>
                <button
                  type="button"
                  onClick={() => setActionError(null)}
                  className="whitespace-nowrap text-red-700 underline"
                >
                  知道了
                </button>
              </div>
            ) : null}

            {activeTab === 'board' ? (
              <>
                {snapshot.conflicts.length > 0 ? (
                  <ConflictZone conflicts={snapshot.conflicts} />
                ) : null}
                <PriorityBoard
                  evaluated={filteredEvaluated}
                  searchQuery={filter.query}
                  layoutMode={layoutMode}
                  selectedIssueId={selectedIssueId}
                  onSelectIssue={setSelectedIssueId}
                  onSetManualTier={(id, tier) =>
                    runMutation(() => api.setManualTier(id, tier))
                  }
                  onConfirmComplete={(id) => runMutation(() => api.confirmComplete(id))}
                  onResetFilters={() => setFilter(DEFAULT_SEARCH_FILTER)}
                />
              </>
            ) : null}

            {activeTab === 'dependencies' ? (
              <DependencyView
                evaluated={snapshot.evaluated}
                onSelectIssue={setSelectedIssueId}
              />
            ) : null}

            {activeTab === 'openspec' ? (
              <OpenSpecView
                facts={snapshot.facts}
                evaluated={snapshot.evaluated}
                onSelectIssue={setSelectedIssueId}
                onArchiveChange={(changeId) =>
                  runMutation(() => api.archiveChange(changeId))
                }
              />
            ) : null}

            {activeTab === 'workspace' ? <WorkspaceView snapshot={snapshot} /> : null}
          </main>

          <IssueInspectorDrawer
            evaluated={selectedEvaluated}
            allIssues={snapshot.issues}
            activeChanges={snapshot.facts.activeChanges}
            openspecInitialized={snapshot.facts.openspecInitialized}
            onCloseDrawer={() => setSelectedIssueId(null)}
            onSetManualTier={(id, tier) =>
              runMutation(() => api.setManualTier(id, tier), { localAlert: true })
            }
            onCloseIssue={(id, reason, note) =>
              runMutation(() => api.closeIssue(id, reason, note), { localAlert: true })
            }
            onReopenIssue={(id) =>
              runMutation(() => api.reopenIssue(id), { localAlert: true })
            }
            onAddDependency={(blockerId, blockedId) =>
              runMutation(() => api.addDependency(blockerId, blockedId), { localAlert: true })
            }
            onRemoveDependency={(blockerId, blockedId) =>
              runMutation(() => api.removeDependency(blockerId, blockedId), {
                localAlert: true,
              })
            }
            onReplaceDependency={(blockedId, oldBlockerId, newBlockerId) =>
              runMutation(
                () => api.replaceDependency(blockedId, oldBlockerId, newBlockerId),
                { localAlert: true },
              )
            }
            onLinkProposal={(id, changeId) =>
              runMutation(() => api.linkProposal(id, changeId), { localAlert: true })
            }
            onConfirmComplete={(id) =>
              runMutation(() => api.confirmComplete(id), { localAlert: true })
            }
          />

          <PrioritizeModal
            open={prioritizeOpen}
            onClose={() => setPrioritizeOpen(false)}
            onApplied={fetchState}
          />
        </>
      ) : null}
    </div>
  );
}
