import type { Workspace } from "@anyharness/sdk";

export type ChatSurfaceState =
  | { kind: "no-workspace" }
  | { kind: "launch-intent"; intentId: string }
  | { kind: "workspace-status" }
  | { kind: "session-loading"; sessionId: string | null }
  | { kind: "session-hydrating"; sessionId: string }
  | { kind: "session-switching"; sessionId: string }
  | { kind: "session-empty"; sessionId: string | null }
  | { kind: "session-transcript"; sessionId: string };

export type LaunchIntentSurfaceOverride =
  | { kind: "launch-intent"; intentId: string }
  | { kind: "session-transcript"; sessionId: string };

export interface ChatSurfaceRenderScope {
  kind: "chat-shell" | "chat-session" | "other";
  sessionId?: string;
}

export interface ChatSessionPendingRenderScope {
  kind: "chat-session-pending";
  sessionId: string;
}

export interface ResolveChatSurfaceStateInput {
  selectedWorkspaceId: string | null;
  hasPendingWorkspaceEntry: boolean;
  activeLaunchIntentId: string | null;
  /** True while the active launch intent is still in flight (not failed). */
  launchIntentInFlight: boolean;
  launchIntentSessionId: string | null;
  selectedLocalWorkspace: Workspace | null;
  isArrivalWorkspace: boolean;
  shouldShowSelectedCloudWorkspaceStatus: boolean;
  shouldPreserveVisibleCloudContent: boolean;
  shellRenderScope: ChatSurfaceRenderScope | ChatSessionPendingRenderScope | null;
  activeSessionId: string | null;
  hasContent: boolean;
  hasTranscriptEntry: boolean;
  hasSlot: boolean;
  transcriptHydrated: boolean;
  isEmpty: boolean;
  isRunning: boolean;
  streamConnectionState: string | null;
}

export function shouldMountWorkspaceShell(args: {
  selectedWorkspaceId: string | null;
  hasPendingWorkspaceEntry: boolean;
  activeLaunchIntentId: string | null;
}): boolean {
  return Boolean(
    args.selectedWorkspaceId
    || args.hasPendingWorkspaceEntry
    || args.activeLaunchIntentId,
  );
}

export function resolveLaunchIntentSurfaceOverride(args: {
  activeLaunchIntentId: string | null;
  launchIntentSessionId: string | null;
  activeSessionId: string | null;
  selectedWorkspaceId: string | null;
  hasVisibleSessionContent: boolean;
}): LaunchIntentSurfaceOverride | null {
  if (!args.activeLaunchIntentId) {
    return null;
  }

  // An intent bound to a session owns only that session's surface. Any other
  // context the user switched to mid-launch — a different active session, or a
  // selected workspace that is not the launch target — keeps its own surface;
  // without this, a single failed launch blocks every session in every
  // workspace (PRO-230).
  if (
    args.launchIntentSessionId
    && args.activeSessionId !== args.launchIntentSessionId
    && (args.activeSessionId !== null || args.selectedWorkspaceId !== null)
  ) {
    return null;
  }

  if (
    args.activeSessionId
    && (!args.launchIntentSessionId || args.activeSessionId === args.launchIntentSessionId)
    && args.hasVisibleSessionContent
  ) {
    return {
      kind: "session-transcript",
      sessionId: args.activeSessionId,
    };
  }

  return {
    kind: "launch-intent",
    intentId: args.activeLaunchIntentId,
  };
}

export function resolveChatSurfaceState(input: ResolveChatSurfaceStateInput): ChatSurfaceState {
  const scopedActiveSessionId = input.shellRenderScope?.kind === "chat-shell"
    ? null
    : input.activeSessionId;
  const scopedHasContent = input.shellRenderScope?.kind === "chat-shell"
    ? false
    : input.hasContent;
  const scopedStreamConnectionState = scopedActiveSessionId ? input.streamConnectionState : null;

  if (
    !input.selectedWorkspaceId
    && !input.hasPendingWorkspaceEntry
    && !input.activeLaunchIntentId
  ) {
    return { kind: "no-workspace" };
  }

  if (input.hasPendingWorkspaceEntry && scopedActiveSessionId) {
    if (scopedHasContent) {
      return { kind: "session-transcript", sessionId: scopedActiveSessionId };
    }
    // With a launch intent still in flight, the queued prompt has not landed
    // in the projected session yet (a one-beat gap after send). Fall through
    // to the launch-intent pane, which already shows the prompt bubble and
    // frontier status at final transcript geometry — rendering session-empty
    // here instead double-mounts the creation receipt (canvas topSlot first,
    // pending-prompt frontier a beat later) and the transcript jumps.
    // Failed intents keep the session-empty surface: the pending entry's
    // creation receipt owns retry/back for local and worktree creations.
    if (!input.launchIntentInFlight) {
      return { kind: "session-empty", sessionId: scopedActiveSessionId };
    }
  }

  const launchIntentOverride = resolveLaunchIntentSurfaceOverride({
    activeLaunchIntentId: input.activeLaunchIntentId,
    launchIntentSessionId: input.launchIntentSessionId,
    activeSessionId: scopedActiveSessionId,
    selectedWorkspaceId: input.selectedWorkspaceId,
    hasVisibleSessionContent: scopedHasContent,
  });
  if (launchIntentOverride) {
    return launchIntentOverride;
  }

  if (input.hasPendingWorkspaceEntry) {
    return { kind: "session-empty", sessionId: scopedActiveSessionId };
  }

  const shouldShowArrivalStatus = input.isArrivalWorkspace
    && !scopedHasContent
    // Keep the arrival/status hero only while the selected workspace is still
    // bootstrapping, hydrating, or actively running its first empty turn.
    // Once the session is already hydrated and idle, fall through to
    // `session-empty` so the ready hero renders instead of a stale loader.
    && (!input.hasSlot || !input.transcriptHydrated || input.isRunning);
  if (input.shouldShowSelectedCloudWorkspaceStatus || shouldShowArrivalStatus) {
    return { kind: "session-empty", sessionId: scopedActiveSessionId };
  }

  if (input.shellRenderScope?.kind === "chat-session-pending") {
    return {
      kind: "session-switching",
      sessionId: input.shellRenderScope.sessionId,
    };
  }

  if (
    input.shellRenderScope?.kind === "chat-session"
    && input.shellRenderScope.sessionId === scopedActiveSessionId
    && !input.hasTranscriptEntry
  ) {
    return { kind: "session-switching", sessionId: input.shellRenderScope.sessionId };
  }

  if (!scopedActiveSessionId) {
    return { kind: "session-empty", sessionId: null };
  }

  // Gate the session-loading state on hasSlot, hydration, and the
  // empty+running race window. The hydration check self-heals once the stream
  // is open: if producer-side auto-hydrate ever misses flipping
  // transcriptHydrated, SSE replay on the live stream will still populate the
  // transcript, so the UI should not stick on loading forever.
  const awaitingHydration = !input.transcriptHydrated && scopedStreamConnectionState !== "open";
  if (!input.hasSlot || awaitingHydration || (input.isEmpty && input.isRunning)) {
    if (scopedHasContent) {
      return { kind: "session-transcript", sessionId: scopedActiveSessionId };
    }
    if (input.hasSlot && awaitingHydration) {
      return { kind: "session-hydrating", sessionId: scopedActiveSessionId };
    }
    return { kind: "session-empty", sessionId: scopedActiveSessionId };
  }

  if (input.shouldPreserveVisibleCloudContent && scopedHasContent) {
    return { kind: "session-transcript", sessionId: scopedActiveSessionId };
  }

  if (input.isEmpty) {
    return { kind: "session-empty", sessionId: scopedActiveSessionId };
  }

  return { kind: "session-transcript", sessionId: scopedActiveSessionId };
}

export function shouldKeepBootstrappedWorkspaceLoading(args: {
  activeSessionId: string | null;
  hasBootstrappedWorkspace: boolean;
  rememberedSessionId: string | null;
}): boolean {
  return !args.activeSessionId
    && args.hasBootstrappedWorkspace
    && !!args.rememberedSessionId;
}
