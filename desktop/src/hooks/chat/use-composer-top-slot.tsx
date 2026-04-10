import type { ReactNode } from "react";
import { CloudRuntimeAttachedPanel } from "@/components/workspace/chat/surface/CloudRuntimeAttachedPanel";
import { WorkspaceArrivalAttachedPanel } from "@/components/workspace/chat/surface/WorkspaceArrivalAttachedPanel";
import { TodoTrackerPanel } from "@/components/workspace/chat/input/TodoTrackerPanel";
import { ConnectedApprovalCard } from "@/components/workspace/chat/input/ApprovalCard";
import { useActiveChatSessionState } from "@/hooks/chat/use-active-chat-session-state";
import { useActiveTodoTracker } from "@/hooks/chat/use-active-todo-tracker";
import { useSelectedCloudRuntimeState } from "@/hooks/workspaces/use-selected-cloud-runtime-state";
import { useWorkspaceStatusPanelState } from "@/hooks/workspaces/use-workspace-status-panel-state";

/**
 * Derives the single-slot inhabitant that should sit above the chat
 * composer. Precedence (highest to lowest):
 *
 *   1. ApprovalCard     — a tool approval is pending
 *   2. TodoTrackerPanel — Codex/Gemini structured_plan is active
 *   3. WorkspaceArrivalAttachedPanel — workspace status panel needs to show
 *   4. CloudRuntimeAttachedPanel     — cloud runtime is still connecting
 *   5. null                           — clean composer
 *
 * When we genuinely need two panels at once, changing the return type
 * from `ReactNode | null` to `ReactNode[]` (and updating the dock to
 * render them stacked) is a mechanical followup.
 */
export function useComposerTopSlot(): ReactNode | null {
  const { hasPendingApproval } = useActiveChatSessionState();
  const activeTodoTracker = useActiveTodoTracker();
  const workspaceStatusPanel = useWorkspaceStatusPanelState();
  const selectedCloudRuntime = useSelectedCloudRuntimeState();

  if (hasPendingApproval) {
    return <ConnectedApprovalCard />;
  }
  if (activeTodoTracker) {
    return <TodoTrackerPanel entries={activeTodoTracker.entries} />;
  }
  if (workspaceStatusPanel) {
    return <WorkspaceArrivalAttachedPanel />;
  }
  if (selectedCloudRuntime.state && selectedCloudRuntime.state.phase !== "ready") {
    return <CloudRuntimeAttachedPanel />;
  }
  return null;
}
