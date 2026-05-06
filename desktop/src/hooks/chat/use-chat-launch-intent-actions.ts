import { useCallback } from "react";
import { useHomeNextLaunch } from "@/hooks/home/use-home-next-launch";
import { useWorkspaceActivationWorkflow } from "@/hooks/workspaces/use-workspace-activation-workflow";
import { useWorkspaceSelection } from "@/hooks/workspaces/selection/use-workspace-selection";
import { useChatLaunchIntentStore } from "@/stores/chat/chat-launch-intent-store";
import { useHomeDraftHandoffStore } from "@/stores/home/home-draft-handoff-store";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";

export function useChatLaunchIntentActions() {
  const activeIntent = useChatLaunchIntentStore((state) => state.activeIntent);
  const clearIfActive = useChatLaunchIntentStore((state) => state.clearIfActive);
  const setHomeDraftText = useHomeDraftHandoffStore((state) => state.setDraftText);
  const deselectWorkspacePreservingSlots = useSessionSelectionStore(
    (state) => state.deselectWorkspacePreservingSessions,
  );
  const setSelectedLogicalWorkspaceId =
    useSessionSelectionStore((state) => state.setSelectedLogicalWorkspaceId);
  const { isLaunching, launch } = useHomeNextLaunch();
  const { openWorkspaceSession } = useWorkspaceActivationWorkflow();
  const { selectWorkspace } = useWorkspaceSelection();

  const retry = useCallback(() => {
    if (!activeIntent || activeIntent.failure?.retryMode !== "safe") {
      return;
    }

    void launch(activeIntent.retryInput);
  }, [activeIntent, launch]);

  const returnHome = useCallback(() => {
    if (!activeIntent) {
      return;
    }

    setHomeDraftText(activeIntent.text);
    setSelectedLogicalWorkspaceId(null);
    deselectWorkspacePreservingSlots();
    clearIfActive(activeIntent.id);
  }, [
    activeIntent,
    clearIfActive,
    deselectWorkspacePreservingSlots,
    setHomeDraftText,
    setSelectedLogicalWorkspaceId,
  ]);

  const dismiss = useCallback(() => {
    if (!activeIntent) {
      return;
    }

    const intent = activeIntent;
    clearIfActive(intent.id);
    if (intent.materializedWorkspaceId && intent.materializedSessionId) {
      void openWorkspaceSession({
        workspaceId: intent.materializedWorkspaceId,
        sessionId: intent.clientSessionId ?? intent.materializedSessionId,
        forceWorkspaceSelection: true,
      }).catch(() => undefined);
      return;
    }
    if (intent.materializedWorkspaceId) {
      void selectWorkspace(intent.materializedWorkspaceId, { force: true })
        .catch(() => undefined);
    }
  }, [
    activeIntent,
    clearIfActive,
    openWorkspaceSession,
    selectWorkspace,
  ]);

  return {
    isRetrying: isLaunching,
    retry,
    returnHome,
    dismiss,
  };
}
