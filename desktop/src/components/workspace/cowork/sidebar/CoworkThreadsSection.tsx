import { useCallback, useMemo, useState } from "react";
import { BrailleSweepBadge, CollapseAll, ExpandAll, Plus } from "@/components/ui/icons";
import { SidebarShowToggleRow } from "@/components/workspace/shell/sidebar/SidebarShowToggleRow";
import { useCoworkStatus } from "@/hooks/access/anyharness/cowork/use-cowork-status";
import { useCoworkThreadWorkflow } from "@/hooks/cowork/workflows/use-cowork-thread-workflow";
import { useCoworkThreads } from "@/hooks/access/anyharness/cowork/use-cowork-threads";
import { useWorkspaceSidebarActivityStates } from "@/hooks/workspaces/derived/use-workspace-sidebar-activities";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useWorkspaceUiStore } from "@/stores/preferences/workspace-ui-store";
import { SidebarActionButton } from "@/components/workspace/shell/sidebar/SidebarActionButton";
import { CoworkThreadItem } from "./CoworkThreadItem";

const DEFAULT_VISIBLE_THREAD_COUNT = 5;

export function CoworkThreadsSection() {
  const selectedWorkspaceId = useSessionSelectionStore((state) => state.selectedWorkspaceId);
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

  const [expandedThreadIds, setExpandedThreadIds] = useState<Set<string>>(new Set());
  const toggleThreadExpanded = useCallback((threadId: string) => {
    setExpandedThreadIds((prev) => {
      const next = new Set(prev);
      if (next.has(threadId)) next.delete(threadId);
      else next.add(threadId);
      return next;
    });
  }, []);

  const overLimit = threads.length > DEFAULT_VISIBLE_THREAD_COUNT;
  const selectedThreadIndex = useMemo(() => (
    selectedWorkspaceId
      ? threads.findIndex((thread) => thread.workspaceId === selectedWorkspaceId)
      : -1
  ), [selectedWorkspaceId, threads]);
  const forceExpanded = !expanded && selectedThreadIndex >= DEFAULT_VISIBLE_THREAD_COUNT;
  const isEffectivelyExpanded = expanded || forceExpanded;
  const visibleThreads = isEffectivelyExpanded
    ? threads
    : threads.slice(0, DEFAULT_VISIBLE_THREAD_COUNT);
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
      <div className="flex items-center justify-between gap-2 pl-2 pb-1 pt-3 text-base text-sidebar-muted-foreground">
        <span>Threads</span>
        <div className="flex shrink-0 items-center gap-1">
          {threads.length > 0 && (
            <SidebarActionButton
              onClick={handleToggleCollapsed}
              title={threadsCollapsed ? "Expand threads" : "Collapse threads"}
              variant="section"
            >
              {threadsCollapsed ? (
                <ExpandAll className="size-3" />
              ) : (
                <CollapseAll className="size-3" />
              )}
            </SidebarActionButton>
          )}
          <SidebarActionButton
            onClick={() => { void createThread(); }}
            disabled={isCreatingThread}
            title="Start a new thread"
            variant="section"
          >
            <Plus className="size-3" />
          </SidebarActionButton>
        </div>
      </div>

      {!threadsCollapsed && (
        <div className="flex flex-col gap-px">
          {statusLoading || threadsLoading ? (
            <div className="flex flex-col items-center gap-2 px-3 py-4 text-center">
              <BrailleSweepBadge className="text-base text-sidebar-foreground" />
              <p className="text-xs text-sidebar-muted-foreground">Loading threads</p>
            </div>
          ) : threads.length === 0 ? (
            <div className="px-2 py-2 text-xs text-sidebar-muted-foreground">
              {isCreatingThread ? "Creating chat" : "No chats yet"}
            </div>
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
                <SidebarShowToggleRow
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
