import { useCallback, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { BrailleSweepBadge, MiniPlus } from "@/components/ui/icons";
import { SidebarActionButton } from "@/components/workspace/shell/sidebar/SidebarActionButton";
import { SidebarShowToggleRow } from "@/components/workspace/shell/sidebar/SidebarShowToggleRow";
import { useCoworkStatus } from "@/hooks/cowork/use-cowork-status";
import { useCoworkThreadWorkflow } from "@/hooks/cowork/use-cowork-thread-workflow";
import { useCoworkThreads } from "@/hooks/cowork/use-cowork-threads";
import { collectWorkspaceSessionViewStates } from "@/lib/domain/sessions/activity";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { CoworkThreadRow } from "./CoworkThreadRow";

const DEFAULT_VISIBLE_THREAD_COUNT = 5;

export function CoworkThreadsSection() {
  const selectedWorkspaceId = useHarnessStore((state) => state.selectedWorkspaceId);
  const workspaceActivities = useHarnessStore(useShallow((state) =>
    collectWorkspaceSessionViewStates(state.sessionSlots)
  ));
  const { status, isLoading: statusLoading } = useCoworkStatus();
  const { threads, isLoading: threadsLoading } = useCoworkThreads(status?.enabled ?? false);
  const { createThread, openThread, isCreatingThread } = useCoworkThreadWorkflow();
  const [expanded, setExpanded] = useState(false);

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

  if (!status?.enabled && !statusLoading) {
    return null;
  }

  return (
    <div className="px-2 pb-2">
      <div className="flex items-center justify-between gap-2 pl-2 pr-1 pb-1 pt-3 text-base text-foreground/50 opacity-75">
        <span>Threads</span>
        <SidebarActionButton
          title="New thread"
          alwaysVisible
          disabled={isCreatingThread}
          onClick={() => { void createThread(); }}
        >
          <MiniPlus className="size-3" />
        </SidebarActionButton>
      </div>

      <div className="flex flex-col gap-px">
        {statusLoading || threadsLoading ? (
          <div className="flex flex-col items-center gap-2 px-3 py-4 text-center">
            <BrailleSweepBadge className="text-base text-foreground" />
            <p className="text-xs text-sidebar-muted-foreground">Loading threads</p>
          </div>
        ) : threads.length === 0 ? (
          <div className="px-2 py-2 text-xs text-sidebar-muted-foreground">
            {isCreatingThread ? "Creating chat" : "No chats yet"}
          </div>
        ) : (
          <>
            {visibleThreads.map((thread) => (
              <CoworkThreadRow
                key={thread.id}
                thread={thread}
                active={selectedWorkspaceId === thread.workspaceId}
                activity={workspaceActivities[thread.workspaceId]}
                onSelect={() => { void openThread(thread.workspaceId); }}
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
    </div>
  );
}
