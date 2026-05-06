import { useMemo } from "react";
import { CHAT_PRE_MESSAGE_LABELS } from "@/config/chat";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useWorkspaces } from "@/hooks/workspaces/use-workspaces";
import { hasWorkspaceBootstrappedInSession } from "@/hooks/workspaces/workspace-bootstrap-memory";
import { workspaceDisplayName } from "@/lib/domain/workspaces/workspace-display";
import { useActiveSessionSurfaceSnapshot } from "./use-active-chat-session-selectors";

/**
 * Disambiguates the loading sub-states that feed ChatLoadingHero. The loading
 * hero is reused by both `workspace-status` and `session-loading` while the
 * selected workspace/session is still being prepared, and each sub-state maps
 * to a human-facing caption under the braille sweep.
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
 *      already marked running; this is braille-only until the first row lands.
 */
export type ChatLoadingSubstep =
  | "bootstrapping-workspace"
  | "opening-session"
  | "connecting-stream"
  | "loading-history"
  | "awaiting-first-turn";

export interface ChatLoadingSubstepState {
  substep: ChatLoadingSubstep;
  caption: string | null;
  workspaceName: string | null;
}

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

  const substep = resolveSubstep({
    activeSessionId,
    selectedWorkspaceId,
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

function resolveSubstep(args: {
  activeSessionId: string | null;
  selectedWorkspaceId: string | null;
  hasSlot: boolean;
  streamConnectionState: string | null;
  transcriptHydrated: boolean;
  isEmpty: boolean;
  isRunning: boolean;
}): ChatLoadingSubstep {
  if (!args.activeSessionId) {
    if (
      args.selectedWorkspaceId
      && hasWorkspaceBootstrappedInSession(args.selectedWorkspaceId)
    ) {
      // Edge case: bootstrap completed without opening a session (e.g.
      // all sessions dismissed). The empty hero takes over from here.
      return "opening-session";
    }
    return "bootstrapping-workspace";
  }

  if (!args.hasSlot) {
    return "opening-session";
  }

  if (!args.transcriptHydrated) {
    if (args.streamConnectionState === "open") {
      return "loading-history";
    }
    return "connecting-stream";
  }

  if (args.isEmpty && args.isRunning) {
    return "awaiting-first-turn";
  }

  // Defensive default for unexpected loading-state drift. The surface hook
  // should normally keep ready/idle states out of ChatLoadingHero.
  return "loading-history";
}
