import type { Workspace } from "@anyharness/sdk";
import { isStructuralRepoWorkspace } from "@/lib/domain/workspaces/display/usability";

export type LaunchIntentSurfaceOverride =
  | { kind: "launch-intent"; intentId: string }
  | { kind: "session-transcript"; sessionId: string };

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
  hasVisibleSessionContent: boolean;
}): LaunchIntentSurfaceOverride | null {
  if (!args.activeLaunchIntentId) {
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

export function shouldShowStructuralRepoWorkspaceStatus(
  workspace: Workspace | null,
  activeSessionId: string | null,
): boolean {
  return !!workspace && isStructuralRepoWorkspace(workspace) && !activeSessionId;
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
