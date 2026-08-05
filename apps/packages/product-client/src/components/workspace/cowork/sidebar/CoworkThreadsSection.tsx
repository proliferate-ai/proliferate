import { useCallback, useMemo, useState } from "react";
import { SkeletonBlock } from "#product/components/feedback/Skeleton";
import { Plus } from "@proliferate/ui/icons";
import { ProductSidebarShowToggleRow } from "#product/components/workspace/shell/sidebar/ProductSidebarShowToggleRow";
import { useCoworkStatus } from "#product/hooks/access/anyharness/cowork/use-cowork-status";
import { useCoworkThreadWorkflow } from "#product/hooks/cowork/workflows/use-cowork-thread-workflow";
import { useCoworkThreads } from "#product/hooks/access/anyharness/cowork/use-cowork-threads";
import { useWorkspaceSidebarActivityStates } from "#product/hooks/workspaces/derived/use-workspace-sidebar-activities";
import { buildPendingWorkspaceUiKey } from "#product/lib/domain/workspaces/creation/pending-entry";
import { SidebarStatusIndicatorView } from "#product/components/workspace/shell/sidebar/SidebarIndicators";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import { useWorkspaceUiStore } from "#product/stores/preferences/workspace-ui-store";
import { SidebarActionButton } from "@proliferate/ui/patterns/SidebarActionButton";
import { CoworkThreadItem } from "#product/components/workspace/cowork/sidebar/CoworkThreadItem";
import { ProductSidebarSectionHeader } from "#product/components/workspace/shell/sidebar/ProductSidebarLayout";
import { ProductSidebarThreadRow } from "#product/components/workspace/shell/sidebar/ProductSidebarThreads";

const DEFAULT_VISIBLE_THREAD_COUNT = 5;

export function CoworkThreadsSection() {
  const selectedWorkspaceId = useSessionSelectionStore((state) => state.selectedWorkspaceId);
  const selectedLogicalWorkspaceId = useSessionSelectionStore((state) =>
    state.selectedLogicalWorkspaceId
  );
  const pendingWorkspaceEntry = useSessionSelectionStore((state) => state.pendingWorkspaceEntry);
  const workspaceActivities = useWorkspaceSidebarActivityStates();
  const { status, isLoading: statusLoading } = useCoworkStatus();
  const { threads, isLoading: threadsLoading } = useCoworkThreads(status?.enabled ?? false);
  const { createThread, openThread, isCreatingThread } = useCoworkThreadWorkflow();
  const [expanded, setExpanded] = useState(false);
  const threadsCollapsed = useWorkspaceUiStore((s) => s.threadsCollapsed);
  const setThreadsCollapsed = useWorkspaceUiStore((s) => s.setThreadsCollapsed);
  const handleToggleCollapsed = useCallback(() => {
    setThreadsCollapsed(!threadsCollapsed);
  }, [setThreadsCollapsed, threadsCollapsed]);
  const pendingCoworkEntry = pendingWorkspaceEntry?.source === "cowork-created"
    ? pendingWorkspaceEntry
    : null;
  const pendingCoworkUiKey = pendingCoworkEntry
    ? buildPendingWorkspaceUiKey(pendingCoworkEntry)
    : null;
  const pendingCoworkOwnsRow = pendingCoworkEntry !== null;
  const pendingCoworkWorkspaceIdToSuppress = pendingCoworkOwnsRow
    ? pendingCoworkEntry?.workspaceId ?? null
    : null;
  // The pending row remains the single presentation owner until activation
  // clears it. Once creation has a real workspace id, suppress that query row
  // instead of swapping identities partway through materialization. Failed
  // entries keep owning the row so their selected shell and error state remain
  // truthful until retry, navigation, or finalization clears the projection.
  const listedThreads = useMemo(() => (
    pendingCoworkWorkspaceIdToSuppress
      ? threads.filter((thread) => thread.workspaceId !== pendingCoworkWorkspaceIdToSuppress)
      : threads
  ), [pendingCoworkWorkspaceIdToSuppress, threads]);
  const showPendingCoworkThread = pendingCoworkOwnsRow;
  const pendingCoworkThreadActive = Boolean(
    pendingCoworkEntry
    && (
      selectedLogicalWorkspaceId === pendingCoworkUiKey
      || (
        pendingCoworkEntry.workspaceId
        && selectedWorkspaceId === pendingCoworkEntry.workspaceId
      )
    ),
  );
  const [expandedThreadIds, setExpandedThreadIds] = useState<Set<string>>(new Set());
  const toggleThreadExpanded = useCallback((threadId: string) => {
    setExpandedThreadIds((prev) => {
      const next = new Set(prev);
      if (next.has(threadId)) next.delete(threadId);
      else next.add(threadId);
      return next;
    });
  }, []);

  const overLimit = listedThreads.length > DEFAULT_VISIBLE_THREAD_COUNT;
  const selectedThreadIndex = useMemo(() => (
    selectedWorkspaceId
      ? listedThreads.findIndex((thread) => thread.workspaceId === selectedWorkspaceId)
      : -1
  ), [listedThreads, selectedWorkspaceId]);
  const forceExpanded = !expanded && selectedThreadIndex >= DEFAULT_VISIBLE_THREAD_COUNT;
  const isEffectivelyExpanded = expanded || forceExpanded;
  const visibleThreads = isEffectivelyExpanded
    ? listedThreads
    : listedThreads.slice(0, DEFAULT_VISIBLE_THREAD_COUNT);
  const toggleLabel: "Show more" | "Show less" | null = !overLimit
    ? null
    : forceExpanded
      ? null
      : expanded
        ? "Show less"
        : "Show more";
  const handleToggleExpanded = useCallback(() => {
    setExpanded((current) => !current);
  }, []);

  return (
    <div className="pb-2">
      <ProductSidebarSectionHeader
        label="Threads"
        collapsed={threadsCollapsed}
        onToggleCollapsed={handleToggleCollapsed}
        actions={(
          <SidebarActionButton
            onClick={() => { void createThread().catch(() => undefined); }}
            disabled={isCreatingThread}
            title="Start a new thread"
            variant="section"
          >
            <Plus className="icon-compact" />
          </SidebarActionButton>
        )}
      />

      {!threadsCollapsed && (
        <div className="flex flex-col gap-px">
          {showPendingCoworkThread && pendingCoworkEntry && (
            <ProductSidebarThreadRow
              active={pendingCoworkThreadActive}
              trailingStatus={(
                <SidebarStatusIndicatorView
                  indicator={pendingCoworkEntry.stage === "failed"
                    ? {
                        kind: "error",
                        tooltip: pendingCoworkEntry.errorMessage ?? "Couldn't start chat",
                      }
                    : { kind: "iterating", tooltip: "Creating chat" }}
                />
              )}
              label={pendingCoworkEntry.displayName}
            />
          )}
          {statusLoading || threadsLoading ? (
            showPendingCoworkThread ? null : (
              <div className="flex flex-col gap-1 px-2 py-2" aria-label="Loading threads" role="status">
                <SkeletonBlock className="h-7 w-full bg-surface-control" />
                <SkeletonBlock className="h-7 w-[82%] bg-surface-control/80" />
                <p className="sr-only">Loading threads</p>
              </div>
            )
          ) : listedThreads.length === 0 ? (
            showPendingCoworkThread ? null : (
              <div className="px-2 py-2 text-ui-sm text-sidebar-muted-foreground">
                {isCreatingThread ? "Creating chat" : "No chats yet"}
              </div>
            )
          ) : (
            <>
              {visibleThreads.map((thread) => (
                <CoworkThreadItem
                  key={thread.id}
                  thread={thread}
                  active={selectedWorkspaceId === thread.workspaceId}
                  activity={workspaceActivities[thread.workspaceId]}
                  expanded={expandedThreadIds.has(thread.id)}
                  onToggleExpanded={() => toggleThreadExpanded(thread.id)}
                  onSelect={() => { void openThread(thread.workspaceId); }}
                  selectedWorkspaceId={selectedWorkspaceId}
                  onOpenWorkspace={(workspaceId) => { void openThread(workspaceId); }}
                />
              ))}
              {toggleLabel && (
                <ProductSidebarShowToggleRow
                  label={toggleLabel}
                  onClick={handleToggleExpanded}
                />
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
