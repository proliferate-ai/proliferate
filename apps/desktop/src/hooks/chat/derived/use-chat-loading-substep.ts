import { useMemo } from "react";
import { CHAT_PRE_MESSAGE_LABELS } from "@/copy/chat/chat-copy";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useWorkspaces } from "@/hooks/workspaces/cache/use-workspaces";
import { hasWorkspaceBootstrappedInSession } from "@/hooks/workspaces/lifecycle/workspace-bootstrap-memory";
import { workspaceDisplayName } from "@/lib/domain/workspaces/display/workspace-display";
import {
  resolveChatLoadingSubstep,
  type ChatLoadingSubstep,
} from "@/lib/domain/chat/surface/chat-loading-substep";
import { useActiveSessionSurfaceSnapshot } from "@/hooks/chat/derived/use-active-session-transcript-state";

/**
 * Disambiguates the loading sub-states that feed ChatLoadingHero. The loading
 * hero is reused by both `workspace-status` and `session-loading` while the
 * selected workspace/session is still being prepared, and each sub-state maps
 * to a human-facing caption.
 *
 * The four sub-states map roughly to phases of the workspace → session
 * → stream → history → first-turn pipeline:
 *
 *   1. bootstrapping-workspace — workspace selected, no session id yet
 *      (bootstrap hook is fetching launch catalog / opening initial session).
 *   2. opening-session         — session id exists but its slot hasn't been
 *      written into the harness store yet.
 *   3. connecting-stream       — slot exists, SSE handle still opening.
 *   4. loading-history         — slot exists, stream is open, transcript
 *      hasn't been hydrated yet.
 *   5. awaiting-first-turn     — hydrated and empty but the runtime is
 *      already marked running; this is agent-thinking UI until the first row lands.
 */
export interface ChatLoadingSubstepState {
  substep: ChatLoadingSubstep;
  caption: string | null;
  workspaceName: string | null;
}

// Owns read-only loading hero context. The loading phase decision is pure
// domain logic; this hook gathers the current selected workspace/session state.
export function useChatLoadingSubstep(): ChatLoadingSubstepState {
  const selectedWorkspaceId = useSessionSelectionStore((state) => state.selectedWorkspaceId);
  const activeSessionId = useSessionSelectionStore((state) => state.activeSessionId);
  const { hasSlot, transcriptHydrated, isEmpty, isRunning, streamConnectionState } =
    useActiveSessionSurfaceSnapshot();
  const { data: workspaceCollections } = useWorkspaces();

  const workspaceName = useMemo(() => {
    if (!selectedWorkspaceId) {
      return null;
    }
    const workspace = workspaceCollections?.workspaces.find(
      (candidate) => candidate.id === selectedWorkspaceId,
    );
    return workspace ? workspaceDisplayName(workspace) : null;
  }, [selectedWorkspaceId, workspaceCollections]);

  const substep = resolveChatLoadingSubstep({
    activeSessionId,
    selectedWorkspaceId,
    hasBootstrappedWorkspace: selectedWorkspaceId
      ? hasWorkspaceBootstrappedInSession(selectedWorkspaceId)
      : false,
    hasSlot,
    streamConnectionState,
    transcriptHydrated,
    isEmpty,
    isRunning,
  });

  return {
    substep,
    caption: CHAT_PRE_MESSAGE_LABELS.loadingCaption[substep],
    workspaceName,
  };
}
