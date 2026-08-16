import { useCallback, useMemo, useState } from "react";
import { LoadingBoundary } from "#product/primitives/LoadingBoundary";
import { Plus } from "#product/primitives/icons/core";
import { ProductSidebarShowToggleRow } from "#product/components/workspace/shell/sidebar/ProductSidebarShowToggleRow";
import { useCoworkStatus } from "#product/hooks/access/anyharness/cowork/use-cowork-status";
import { useCoworkThreadWorkflow } from "#product/hooks/cowork/workflows/use-cowork-thread-workflow";
import { useCoworkThreads } from "#product/hooks/access/anyharness/cowork/use-cowork-threads";
import { useWorkspaceSidebarActivityStates } from "#product/hooks/workspaces/derived/use-workspace-sidebar-activities";
import {
  buildPendingWorkspaceUiKey,
  type PendingWorkspaceEntry,
} from "#product/lib/domain/workspaces/creation/pending-entry";
import { SidebarStatusIndicatorView } from "#product/components/workspace/shell/sidebar/SidebarIndicators";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import { usePendingWorkspaceEntries } from "#product/hooks/workspaces/derived/use-pending-workspace-entries";
import { useWorkspaceUiStore } from "#product/stores/preferences/workspace-ui-store";
import { SidebarActionButton } from "#product/primitives/patterns/sidebar/SidebarActionButton";
import { CoworkThreadItem } from "#product/components/workspace/cowork/sidebar/CoworkThreadItem";
import { ProductSidebarSectionHeader } from "#product/components/workspace/shell/sidebar/ProductSidebarLayout";
import { ProductSidebarThreadRow } from "#product/components/workspace/shell/sidebar/ProductSidebarThreads";

const DEFAULT_VISIBLE_THREAD_COUNT = 5;

export function CoworkThreadsSection() {
  const selectedWorkspaceId = useSessionSelectionStore((state) => state.selectedWorkspaceId);
  const selectedLogicalWorkspaceId = useSessionSelectionStore((state) =>
    state.selectedLogicalWorkspaceId
  );
  const pendingWorkspaceEntries = usePendingWorkspaceEntries();
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
  // Cowork-created attempts are excluded from the repo sidebar projection, so
  // this section is the only place they appear — and several can be starting at
  // once (PRO-230).
  const pendingCoworkEntries = useMemo(
    () => pendingWorkspaceEntries.filter((entry) => entry.source === "cowork-created"),
    [pendingWorkspaceEntries],
  );
  // Each pending row remains the single presentation owner of its thread until
  // activation clears it. Once a creation has a real workspace id, suppress
  // that query row instead of swapping identities partway through
  // materialization. Failed entries keep owning their row so their selected
  // shell and error state remain truthful until retry, navigation, or
  // finalization clears the projection.
  const pendingCoworkWorkspaceIdsToSuppress = useMemo(
    () => new Set(
      pendingCoworkEntries
        .map((entry) => entry.workspaceId)
        .filter((workspaceId): workspaceId is string => workspaceId !== null),
    ),
    [pendingCoworkEntries],
  );
  const listedThreads = useMemo(() => (
    pendingCoworkWorkspaceIdsToSuppress.size > 0
      ? threads.filter((thread) => !pendingCoworkWorkspaceIdsToSuppress.has(thread.workspaceId))
      : threads
  ), [pendingCoworkWorkspaceIdsToSuppress, threads]);
  const showPendingCoworkThreads = pendingCoworkEntries.length > 0;
  const isPendingCoworkThreadActive = useCallback((entry: PendingWorkspaceEntry) => (
    selectedLogicalWorkspaceId === buildPendingWorkspaceUiKey(entry)
    || Boolean(entry.workspaceId && selectedWorkspaceId === entry.workspaceId)
  ), [selectedLogicalWorkspaceId, selectedWorkspaceId]);
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
          {pendingCoworkEntries.map((entry) => (
            <ProductSidebarThreadRow
              key={entry.attemptId}
              active={isPendingCoworkThreadActive(entry)}
              trailingStatus={(
                <SidebarStatusIndicatorView
                  indicator={entry.stage === "failed"
                    ? {
                        kind: "error",
                        tooltip: entry.errorMessage ?? "Couldn't start chat",
                      }
                    : { kind: "iterating", tooltip: "Creating chat" }}
                />
              )}
              label={entry.displayName}
            />
          ))}
          {/* Class C big-surface treatment (UX Latency + Transitions ADR §4
              Rung 4, FR-1): this thread list retired its placeholder-row
              skeleton. The sidebar section header above is the stable shell.
              "No chats yet" is a resolved outcome that may only render once
              both status and thread queries settle (`state="empty"`), never
              while either is still loading (Q19 empty split). Pending cowork
              creations own their own rows above, so they suppress the empty
              slot the same way the skeleton was suppressed before. */}
          <LoadingBoundary
            state={
              statusLoading || threadsLoading
                ? "pending"
                : listedThreads.length === 0
                  ? "empty"
                  : "ready"
            }
            diagnostics={{ flow: "cowork_threads" }}
            treatment={null}
            emptyContent={
              showPendingCoworkThreads ? null : (
                <div className="px-2 py-2 text-ui-sm text-sidebar-muted-foreground">
                  {isCreatingThread ? "Creating chat" : "No chats yet"}
                </div>
              )
            }
          >
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
          </LoadingBoundary>
        </div>
      )}
    </div>
  );
}
