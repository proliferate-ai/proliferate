import { useCallback } from "react";
import { useHomeNextLaunch } from "#product/hooks/home/workflows/use-home-next-launch";
import { useWorkspaceActivationWorkflow } from "#product/hooks/workspaces/workflows/use-workspace-activation-workflow";
import { useWorkspaceSelection } from "#product/hooks/workspaces/workflows/selection/use-workspace-selection";
import { useShellLaunchIntent } from "#product/hooks/chat/derived/use-shell-launch-intent";
import { useChatLaunchIntentStore } from "#product/stores/chat/chat-launch-intent-store";
import { useHomeDraftHandoffStore } from "#product/stores/home/home-draft-handoff-store";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";

// Retry/back/dismiss act on this shell's own launch intent, never on "the"
// intent: with several launches in flight the pane the user is looking at owns
// exactly one of them (PRO-230).
export function useChatLaunchIntentActions() {
  const activeIntent = useShellLaunchIntent();
  const clearLaunchIntent = useChatLaunchIntentStore((state) => state.clear);
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

    const retried = activeIntent;
    // The replacement launch owns this shell from the moment it begins (it is
    // the newer intent), so the failed one is cleared once the replacement has
    // settled rather than before it exists — otherwise the pane blinks empty on
    // the way out, and left alone the stale intent re-mounts "Couldn't start
    // work" over Home after the replacement succeeds (PRO-230 review finding
    // 4). A launch that never started (cap, unavailable target) minted no
    // replacement, so the failed intent stays: it is still the only place the
    // user's prompt lives.
    void launch(retried.retryInput).then((outcome) => {
      if (outcome === "launched" || outcome === "not-started") {
        clearLaunchIntent(retried.id);
      }
    });
  }, [activeIntent, clearLaunchIntent, launch]);

  const returnHome = useCallback(() => {
    if (!activeIntent) {
      return;
    }

    setHomeDraftText(activeIntent.text);
    setSelectedLogicalWorkspaceId(null);
    deselectWorkspacePreservingSlots();
    clearLaunchIntent(activeIntent.id);
  }, [
    activeIntent,
    clearLaunchIntent,
    deselectWorkspacePreservingSlots,
    setHomeDraftText,
    setSelectedLogicalWorkspaceId,
  ]);

  const dismiss = useCallback(() => {
    if (!activeIntent) {
      return;
    }

    const intent = activeIntent;
    clearLaunchIntent(intent.id);
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
    clearLaunchIntent,
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
