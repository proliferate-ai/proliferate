import type { ReactNode } from "react";
import { CloudRuntimeAttachedPanel } from "@/components/workspace/chat/surface/CloudRuntimeAttachedPanel";
import { WorkspaceArrivalAttachedPanel } from "@/components/workspace/chat/surface/WorkspaceArrivalAttachedPanel";
import { TodoTrackerPanel } from "@/components/workspace/chat/input/TodoTrackerPanel";
import { ConnectedApprovalCard } from "@/components/workspace/chat/input/ApprovalCard";
import { ConnectedMcpElicitationCard } from "@/components/workspace/chat/input/McpElicitationCard";
import { ConnectedPendingPromptList } from "@/components/workspace/chat/input/PendingPromptList";
import { ConnectedUserInputCard } from "@/components/workspace/chat/input/UserInputCard";
import { useActiveChatSessionState } from "@/hooks/chat/use-active-chat-session-state";
import { useActiveTodoTracker } from "@/hooks/chat/use-active-todo-tracker";
import { useSelectedCloudRuntimeState } from "@/hooks/workspaces/use-selected-cloud-runtime-state";
import { useWorkspaceStatusPanelState } from "@/hooks/workspaces/use-workspace-status-panel-state";

/**
 * Derives the inhabitant(s) of the single flex-col slot that sits above
 * the chat composer. When the durable prompt queue is non-empty, the
 * queue list is always rendered closest to the composer (visually at
 * the bottom of the stack). Above the queue, one of the existing
 * single-panel slots renders with the previous precedence:
 *
 *   1. Interaction card — FIFO permission/user input/MCP interaction is pending
 *   2. TodoTrackerPanel — Codex/Gemini structured_plan is active
 *   3. WorkspaceArrivalAttachedPanel — workspace status panel needs to show
 *   4. CloudRuntimeAttachedPanel     — cloud runtime is still connecting
 *   5. null                           — clean composer
 */
export function useComposerTopSlot(): ReactNode | null {
  const { primaryPendingInteraction, pendingPrompts } = useActiveChatSessionState();
  const activeTodoTracker = useActiveTodoTracker();
  const workspaceStatusPanel = useWorkspaceStatusPanelState();
  const selectedCloudRuntime = useSelectedCloudRuntimeState();

  const interactionPanel: ReactNode | null = primaryPendingInteraction?.kind === "permission"
    ? <ConnectedApprovalCard />
    : primaryPendingInteraction?.kind === "user_input"
      ? <ConnectedUserInputCard />
      : primaryPendingInteraction?.kind === "mcp_elicitation"
        ? <ConnectedMcpElicitationCard />
        : null;

  const upperPanel: ReactNode | null = interactionPanel
    ? interactionPanel
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
