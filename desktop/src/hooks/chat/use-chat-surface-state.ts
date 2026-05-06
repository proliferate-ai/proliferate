import { useWorkspaces } from "@/hooks/workspaces/use-workspaces";
import { useSelectedCloudRuntimeState } from "@/hooks/workspaces/use-selected-cloud-runtime-state";
import {
  resolveLaunchIntentSurfaceOverride,
  shouldShowStructuralRepoWorkspaceStatus,
} from "@/lib/domain/chat/chat-surface";
import { shouldShowCloudWorkspaceStatusScreen } from "@/lib/domain/workspaces/cloud-workspace-status";
import { parseCloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud-ids";
import { useChatLaunchIntentStore } from "@/stores/chat/chat-launch-intent-store";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useActiveSessionSurfaceSnapshot } from "./use-active-chat-session-selectors";
import type { WorkspaceRenderSurface } from "@/lib/domain/workspaces/tabs/shell-activation";

export type ChatSurfaceState =
  | { kind: "no-workspace" }
  | { kind: "launch-intent"; intentId: string }
  | { kind: "workspace-status" }
  | { kind: "session-loading"; sessionId: string | null }
  | { kind: "session-switching"; sessionId: string }
  | { kind: "session-empty"; sessionId: string | null }
  | { kind: "session-transcript"; sessionId: string };

export function useChatSurfaceState(shellRenderSurface?: WorkspaceRenderSurface | null): {
  mode: ChatSurfaceState;
  selectedWorkspaceId: string | null;
} {
  const selectedWorkspaceId = useSessionSelectionStore((state) => state.selectedWorkspaceId);
  const pendingWorkspaceEntry = useSessionSelectionStore((state) => state.pendingWorkspaceEntry);
  const workspaceArrivalEvent = useSessionSelectionStore((state) => state.workspaceArrivalEvent);
  const activeLaunchIntent = useChatLaunchIntentStore((state) => state.activeIntent);
  const { data: workspaceCollections } = useWorkspaces();
  const selectedCloudRuntime = useSelectedCloudRuntimeState();
  const {
    activeSessionId,
    hasContent,
    hasSlot,
    transcriptHydrated,
    isEmpty,
    isRunning,
    streamConnectionState,
  } = useActiveSessionSurfaceSnapshot();
  const scopedActiveSessionId = shellRenderSurface?.kind === "chat-shell"
    ? null
    : activeSessionId;
  const scopedHasContent = shellRenderSurface?.kind === "chat-shell"
    ? false
    : hasContent;
  const scopedStreamConnectionState = scopedActiveSessionId ? streamConnectionState : null;

  if (!selectedWorkspaceId && !pendingWorkspaceEntry && !activeLaunchIntent) {
    return { mode: { kind: "no-workspace" }, selectedWorkspaceId };
  }

  const selectedCloudWorkspaceId = parseCloudWorkspaceSyntheticId(selectedWorkspaceId);
  const selectedCloudWorkspace =
    workspaceCollections?.cloudWorkspaces.find((workspace) => workspace.id === selectedCloudWorkspaceId)
    ?? null;

  const launchIntentOverride = resolveLaunchIntentSurfaceOverride({
    activeLaunchIntentId: activeLaunchIntent?.id ?? null,
    launchIntentSessionId: activeLaunchIntent?.materializedSessionId ?? null,
    activeSessionId: scopedActiveSessionId,
    hasVisibleSessionContent: scopedHasContent,
  });
  if (launchIntentOverride?.kind === "session-transcript") {
    return {
      mode: {
        kind: "session-transcript",
        sessionId: launchIntentOverride.sessionId,
      },
      selectedWorkspaceId,
    };
  }
  if (launchIntentOverride?.kind === "launch-intent") {
    return {
      mode: launchIntentOverride,
      selectedWorkspaceId,
    };
  }

  if (pendingWorkspaceEntry) {
    return { mode: { kind: "session-empty", sessionId: scopedActiveSessionId }, selectedWorkspaceId };
  }

  // Structural repo rows default to the status screen, but once a session is
  // active we should let the normal transcript/loading states render.
  const selectedLocalWorkspace = selectedWorkspaceId
    ? workspaceCollections?.localWorkspaces?.find((w) => w.id === selectedWorkspaceId)
    : null;
  if (shouldShowStructuralRepoWorkspaceStatus(selectedLocalWorkspace ?? null, scopedActiveSessionId)) {
    return { mode: { kind: "session-empty", sessionId: null }, selectedWorkspaceId };
  }

  const isArrivalWorkspace = workspaceArrivalEvent?.workspaceId === selectedWorkspaceId;
  const shouldShowCloudStatus = selectedCloudWorkspace
    && shouldShowCloudWorkspaceStatusScreen(selectedCloudWorkspace);
  const shouldShowArrivalStatus = isArrivalWorkspace
    && !scopedHasContent
    // Keep the arrival/status hero only while the selected workspace is still
    // bootstrapping, hydrating, or actively running its first empty turn.
    // Once the session is already hydrated and idle, fall through to
    // `session-empty` so the ready hero renders instead of a stale loader.
    && (!hasSlot || !transcriptHydrated || isRunning);
  if (shouldShowCloudStatus || shouldShowArrivalStatus) {
    return { mode: { kind: "session-empty", sessionId: scopedActiveSessionId }, selectedWorkspaceId };
  }

  const shouldPreserveTranscript = selectedCloudRuntime.state?.preserveVisibleContent && scopedHasContent;

  if (shellRenderSurface?.kind === "chat-session-pending") {
    return {
      mode: { kind: "session-switching", sessionId: shellRenderSurface.sessionId },
      selectedWorkspaceId,
    };
  }

  if (!scopedActiveSessionId) {
    return { mode: { kind: "session-empty", sessionId: null }, selectedWorkspaceId };
  }

  // Gate the session-loading state on hasSlot, hydration, and the
  // empty+running race window. The hydration check self-heals once the
  // stream is open: if the producer-side auto-hydrate in
  // ensureSessionStreamConnected ever misses flipping transcriptHydrated
  // (leaky path or stale in-memory slot from before that fix landed), SSE
  // replay on the live stream will populate the transcript anyway, so we
  // should not stick on "Loading history" forever just because a flag
  // didn't flip.
  const awaitingHydration = !transcriptHydrated && scopedStreamConnectionState !== "open";
  if (!hasSlot || awaitingHydration || (isEmpty && isRunning)) {
    if (scopedHasContent) {
      return { mode: { kind: "session-transcript", sessionId: scopedActiveSessionId }, selectedWorkspaceId };
    }
    return { mode: { kind: "session-empty", sessionId: scopedActiveSessionId }, selectedWorkspaceId };
  }

  if (shouldPreserveTranscript) {
    return { mode: { kind: "session-transcript", sessionId: scopedActiveSessionId }, selectedWorkspaceId };
  }

  if (isEmpty) {
    return { mode: { kind: "session-empty", sessionId: scopedActiveSessionId }, selectedWorkspaceId };
  }

  return { mode: { kind: "session-transcript", sessionId: scopedActiveSessionId }, selectedWorkspaceId };
}
