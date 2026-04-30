import { useWorkspaces } from "@/hooks/workspaces/use-workspaces";
import { useSelectedCloudRuntimeState } from "@/hooks/workspaces/use-selected-cloud-runtime-state";
import {
  resolveLaunchIntentSurfaceOverride,
  shouldKeepBootstrappedWorkspaceLoading,
  shouldShowStructuralRepoWorkspaceStatus,
} from "@/lib/domain/chat/chat-surface";
import { shouldShowCloudWorkspaceStatusScreen } from "@/lib/domain/workspaces/cloud-workspace-status";
import { parseCloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud-ids";
import { useChatLaunchIntentStore } from "@/stores/chat/chat-launch-intent-store";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { useWorkspaceUiStore } from "@/stores/preferences/workspace-ui-store";
import { useLogicalWorkspaceStore } from "@/stores/workspaces/logical-workspace-store";
import { hasWorkspaceBootstrappedInSession } from "@/hooks/workspaces/workspace-bootstrap-memory";
import { useActiveChatSessionState } from "./use-active-chat-session-state";

export type ChatSurfaceState =
  | { kind: "no-workspace" }
  | { kind: "launch-intent"; intentId: string }
  | { kind: "workspace-status" }
  | { kind: "session-loading"; sessionId: string | null }
  | { kind: "session-empty"; sessionId: string | null }
  | { kind: "session-transcript"; sessionId: string };

export function useChatSurfaceState(): {
  mode: ChatSurfaceState;
  selectedWorkspaceId: string | null;
} {
  const selectedWorkspaceId = useHarnessStore((state) => state.selectedWorkspaceId);
  const pendingWorkspaceEntry = useHarnessStore((state) => state.pendingWorkspaceEntry);
  const workspaceArrivalEvent = useHarnessStore((state) => state.workspaceArrivalEvent);
  const activeLaunchIntent = useChatLaunchIntentStore((state) => state.activeIntent);
  const selectedLogicalWorkspaceId = useLogicalWorkspaceStore((state) => state.selectedLogicalWorkspaceId);
  const rememberedSessionId = useWorkspaceUiStore((state) => {
    const workspaceKey = selectedLogicalWorkspaceId ?? selectedWorkspaceId;
    return workspaceKey ? state.lastViewedSessionByWorkspace[workspaceKey] ?? null : null;
  });
  const { data: workspaceCollections } = useWorkspaces();
  const selectedCloudRuntime = useSelectedCloudRuntimeState();
  const {
    activeSessionId,
    hasContent,
    hasSlot,
    transcriptHydrated,
    isEmpty,
    isRunning,
  } = useActiveChatSessionState();
  const streamConnectionState = useHarnessStore((state) =>
    state.activeSessionId
      ? state.sessionSlots[state.activeSessionId]?.streamConnectionState ?? null
      : null,
  );

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
    activeSessionId,
    hasVisibleSessionContent: hasContent,
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
    return { mode: { kind: "workspace-status" }, selectedWorkspaceId };
  }

  // Structural repo rows default to the status screen, but once a session is
  // active we should let the normal transcript/loading states render.
  const selectedLocalWorkspace = selectedWorkspaceId
    ? workspaceCollections?.localWorkspaces?.find((w) => w.id === selectedWorkspaceId)
    : null;
  if (shouldShowStructuralRepoWorkspaceStatus(selectedLocalWorkspace ?? null, activeSessionId)) {
    return { mode: { kind: "workspace-status" }, selectedWorkspaceId };
  }

  const isArrivalWorkspace = workspaceArrivalEvent?.workspaceId === selectedWorkspaceId;
  const shouldShowCloudStatus = selectedCloudWorkspace
    && shouldShowCloudWorkspaceStatusScreen(selectedCloudWorkspace);
  const shouldShowArrivalStatus = isArrivalWorkspace
    && !hasContent
    // Keep the arrival/status hero only while the selected workspace is still
    // bootstrapping, hydrating, or actively running its first empty turn.
    // Once the session is already hydrated and idle, fall through to
    // `session-empty` so the ready hero renders instead of a stale loader.
    && (!hasSlot || !transcriptHydrated || isRunning);
  if (shouldShowCloudStatus || shouldShowArrivalStatus) {
    return { mode: { kind: "workspace-status" }, selectedWorkspaceId };
  }

  const shouldPreserveTranscript = selectedCloudRuntime.state?.preserveVisibleContent && hasContent;
  const hasBootstrappedWorkspace =
    !!selectedWorkspaceId && hasWorkspaceBootstrappedInSession(selectedWorkspaceId);

  if (!activeSessionId) {
    if (shouldKeepBootstrappedWorkspaceLoading({
      activeSessionId,
      hasBootstrappedWorkspace,
      rememberedSessionId,
    })) {
      return { mode: { kind: "session-loading", sessionId: null }, selectedWorkspaceId };
    }
    if (hasBootstrappedWorkspace) {
      return { mode: { kind: "session-empty", sessionId: null }, selectedWorkspaceId };
    }
    return { mode: { kind: "session-loading", sessionId: null }, selectedWorkspaceId };
  }

  // Gate the session-loading state on hasSlot, hydration, and the
  // empty+running race window. The hydration check self-heals once the
  // stream is open: if the producer-side auto-hydrate in
  // ensureSessionStreamConnected ever misses flipping transcriptHydrated
  // (leaky path or stale in-memory slot from before that fix landed), SSE
  // replay on the live stream will populate the transcript anyway, so we
  // should not stick on "Loading history" forever just because a flag
  // didn't flip.
  const awaitingHydration = !transcriptHydrated && streamConnectionState !== "open";
  if (!hasSlot || awaitingHydration || (isEmpty && isRunning)) {
    return { mode: { kind: "session-loading", sessionId: activeSessionId }, selectedWorkspaceId };
  }

  if (shouldPreserveTranscript) {
    return { mode: { kind: "session-transcript", sessionId: activeSessionId }, selectedWorkspaceId };
  }

  if (isEmpty) {
    return { mode: { kind: "session-empty", sessionId: activeSessionId }, selectedWorkspaceId };
  }

  return { mode: { kind: "session-transcript", sessionId: activeSessionId }, selectedWorkspaceId };
}
