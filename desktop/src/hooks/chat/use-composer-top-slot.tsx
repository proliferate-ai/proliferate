import type { ReactNode } from "react";
import { CloudRuntimeAttachedPanel } from "@/components/workspace/chat/surface/CloudRuntimeAttachedPanel";
import { WorkspaceArrivalAttachedPanel } from "@/components/workspace/chat/surface/WorkspaceArrivalAttachedPanel";
import { TodoTrackerPanel } from "@/components/workspace/chat/input/TodoTrackerPanel";
import { ConnectedApprovalCard } from "@/components/workspace/chat/input/ApprovalCard";
import { ConnectedPendingPromptList } from "@/components/workspace/chat/input/PendingPromptList";
import { useActiveChatSessionState } from "@/hooks/chat/use-active-chat-session-state";
import { useActiveTodoTracker } from "@/hooks/chat/use-active-todo-tracker";
import { useSelectedCloudRuntimeState } from "@/hooks/workspaces/use-selected-cloud-runtime-state";
import { useSelectedWorkspace } from "@/hooks/workspaces/use-selected-workspace";
import { useWorkspaceStatusPanelState } from "@/hooks/workspaces/use-workspace-status-panel-state";

/**
 * Derives the inhabitant(s) of the single flex-col slot that sits above
 * the chat composer. When the durable prompt queue is non-empty, the
 * queue list is always rendered closest to the composer (visually at
 * the bottom of the stack). Above the queue, one of the existing
 * single-panel slots renders with the previous precedence:
 *
 *   1. ApprovalCard     — a tool approval is pending
 *   2. TodoTrackerPanel — Codex/Gemini structured_plan is active
 *   3. WorkspaceArrivalAttachedPanel — workspace status panel needs to show
 *   4. CloudRuntimeAttachedPanel     — cloud runtime is still connecting
 *   5. null                           — clean composer
 */
export function useComposerTopSlot(): ReactNode | null {
  const { hasPendingApproval, pendingPrompts } = useActiveChatSessionState();
  const activeTodoTracker = useActiveTodoTracker();
  const workspaceStatusPanel = useWorkspaceStatusPanelState();
  const selectedCloudRuntime = useSelectedCloudRuntimeState();
  const { isCoworkWorkspaceSelected } = useSelectedWorkspace();

  const upperPanel: ReactNode | null = isCoworkWorkspaceSelected
    ? activeTodoTracker
      ? <TodoTrackerPanel entries={activeTodoTracker.entries} />
      : null
    : hasPendingApproval
    ? <ConnectedApprovalCard />
    : activeTodoTracker
      ? <TodoTrackerPanel entries={activeTodoTracker.entries} />
      : workspaceStatusPanel
        ? <WorkspaceArrivalAttachedPanel />
        : selectedCloudRuntime.state && selectedCloudRuntime.state.phase !== "ready"
          ? <CloudRuntimeAttachedPanel />
          : null;

  const hasQueue = pendingPrompts.length > 0;

  if (!upperPanel && !hasQueue) {
    return null;
  }

  return (
    <>
      {upperPanel}
      {hasQueue && <ConnectedPendingPromptList />}
    </>
  );
}
