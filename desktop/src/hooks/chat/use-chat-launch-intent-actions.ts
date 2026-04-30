import { useCallback } from "react";
import { useHomeNextLaunch } from "@/hooks/home/use-home-next-launch";
import { useSessionRuntimeActions } from "@/hooks/sessions/use-session-runtime-actions";
import { useChatLaunchIntentStore } from "@/stores/chat/chat-launch-intent-store";
import { useHomeDraftHandoffStore } from "@/stores/home/home-draft-handoff-store";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { useLogicalWorkspaceStore } from "@/stores/workspaces/logical-workspace-store";

export function useChatLaunchIntentActions() {
  const activeIntent = useChatLaunchIntentStore((state) => state.activeIntent);
  const clearIfActive = useChatLaunchIntentStore((state) => state.clearIfActive);
  const setHomeDraftText = useHomeDraftHandoffStore((state) => state.setDraftText);
  const deselectWorkspacePreservingSlots = useHarnessStore(
    (state) => state.deselectWorkspacePreservingSlots,
  );
  const setSelectedWorkspace = useHarnessStore((state) => state.setSelectedWorkspace);
  const setSelectedLogicalWorkspaceId =
    useLogicalWorkspaceStore((state) => state.setSelectedLogicalWorkspaceId);
  const { activateSession, ensureSessionStreamConnected } = useSessionRuntimeActions();
  const { isLaunching, launch } = useHomeNextLaunch();

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

    if (activeIntent.materializedWorkspaceId) {
      setSelectedWorkspace(activeIntent.materializedWorkspaceId, {
        initialActiveSessionId: activeIntent.materializedSessionId,
        clearPending: true,
      });
    }
    if (activeIntent.materializedSessionId) {
      activateSession(activeIntent.materializedSessionId);
      void ensureSessionStreamConnected(activeIntent.materializedSessionId, {
        resumeIfActive: false,
      });
    }
    clearIfActive(activeIntent.id);
  }, [
    activeIntent,
    activateSession,
    clearIfActive,
    ensureSessionStreamConnected,
    setSelectedWorkspace,
  ]);

  return {
    isRetrying: isLaunching,
    retry,
    returnHome,
    dismiss,
  };
}
