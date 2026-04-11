import type { Workspace } from "@anyharness/sdk";
import { isStructuralRepoWorkspace } from "@/lib/domain/workspaces/usability";

export type ChatSurfaceState =
  | { kind: "no-workspace" }
  | { kind: "pending-thread-creation" }
  | { kind: "workspace-status" }
  | { kind: "session-loading"; sessionId: string | null }
  | { kind: "session-empty"; sessionId: string | null }
  | { kind: "session-transcript"; sessionId: string };

export function shouldShowStructuralRepoWorkspaceStatus(
  workspace: Workspace | null,
  activeSessionId: string | null,
): boolean {
  return !!workspace && isStructuralRepoWorkspace(workspace) && !activeSessionId;
}

interface ResolveChatSurfaceStateArgs {
  selectedWorkspaceId: string | null;
  selectedWorkspace: Workspace | null;
  hasPendingWorkspaceEntry: boolean;
  hasPendingCoworkThread: boolean;
  shouldShowCloudStatus: boolean;
  isArrivalWorkspaceWithoutContent: boolean;
  activeSessionId: string | null;
  hasWorkspaceBootstrappedInSession: boolean;
  hasSlot: boolean;
  transcriptHydrated: boolean;
  isEmpty: boolean;
  isRunning: boolean;
  streamConnectionState: string | null;
  shouldPreserveTranscript: boolean;
}

export function resolveChatSurfaceState(
  args: ResolveChatSurfaceStateArgs,
): ChatSurfaceState {
  if (args.hasPendingCoworkThread) {
    return { kind: "pending-thread-creation" };
  }

  if (!args.selectedWorkspaceId && !args.hasPendingWorkspaceEntry) {
    return { kind: "no-workspace" };
  }

  if (args.hasPendingWorkspaceEntry) {
    return { kind: "workspace-status" };
  }

  if (shouldShowStructuralRepoWorkspaceStatus(
    args.selectedWorkspace,
    args.activeSessionId,
  )) {
    return { kind: "workspace-status" };
  }

  if (args.shouldShowCloudStatus || args.isArrivalWorkspaceWithoutContent) {
    return { kind: "workspace-status" };
  }

  if (!args.activeSessionId) {
    if (
      args.selectedWorkspaceId
      && args.hasWorkspaceBootstrappedInSession
    ) {
      return { kind: "session-empty", sessionId: null };
    }
    return { kind: "session-loading", sessionId: null };
  }

  const awaitingHydration =
    !args.transcriptHydrated && args.streamConnectionState !== "open";
  if (!args.hasSlot || awaitingHydration || (args.isEmpty && args.isRunning)) {
    return { kind: "session-loading", sessionId: args.activeSessionId };
  }

  if (args.shouldPreserveTranscript) {
    return { kind: "session-transcript", sessionId: args.activeSessionId };
  }

  if (args.isEmpty) {
    return { kind: "session-empty", sessionId: args.activeSessionId };
  }

  return { kind: "session-transcript", sessionId: args.activeSessionId };
}
