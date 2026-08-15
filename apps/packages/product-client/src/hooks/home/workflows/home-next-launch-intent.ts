import {
  resolveChatLaunchRetryMode,
  resolveLaunchIntentPendingAttemptId,
  resolveLaunchIntentPendingWorkspaceId,
  type ChatLaunchRetryMode,
} from "#product/lib/domain/chat/launch/launch-intent";
import type { HomeLaunchTarget, HomeNextModelSelection } from "#product/lib/domain/home/home-next-launch";
import type { PendingWorkspaceInitialSession } from "#product/lib/domain/workspaces/creation/pending-entry";
import { useChatLaunchIntentStore } from "#product/stores/chat/chat-launch-intent-store";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";

export function homeNextLaunchErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Names the place the work was going to run. Home launches from a repo card, so
 * by the time a toast appears the user may have several plausible targets in
 * mind; the branch or repo they picked is what disambiguates.
 */
export function describeHomeLaunchTarget(target: HomeLaunchTarget): string {
  switch (target.kind) {
    case "cowork":
      return "a new Cowork thread";
    case "local":
      return target.sourceRoot;
    case "worktree":
      return `a worktree from ${target.baseBranch}`;
    case "cloud":
      return `${target.gitOwner}/${target.gitRepoName} (${target.baseBranch})`;
  }
}

export function modeOptions(modeId: string | null): { modeId?: string } {
  return modeId ? { modeId } : {};
}

export function newHomeNextLaunchId(): string {
  return crypto.randomUUID();
}

export function buildResolvedHomeLaunchControlValues(input: {
  modeId: string | null;
  launchControlValues?: Record<string, string>;
}): Record<string, string> {
  return {
    ...input.launchControlValues,
    ...(input.modeId ? { mode: input.modeId } : {}),
  };
}

export function buildHomePendingWorkspaceInitialSession(input: {
  modelSelection: HomeNextModelSelection;
  modeId: string | null;
  launchControlValues: Record<string, string>;
}): PendingWorkspaceInitialSession {
  return {
    kind: "session",
    agentKind: input.modelSelection.kind,
    modelId: input.modelSelection.modelId,
    modeId: input.modeId,
    launchControlValues: input.launchControlValues,
    displayTitle: input.modelSelection.modelId,
  };
}

export function markHomeLaunchIntentMaterializedFromPendingWorkspace(intentId: string): void {
  const activeIntent = useChatLaunchIntentStore.getState().activeIntent;
  if (!activeIntent || activeIntent.id !== intentId) {
    return;
  }

  const pendingWorkspaceEntry = useSessionSelectionStore.getState().pendingWorkspaceEntry;
  const workspaceId = resolveLaunchIntentPendingWorkspaceId(activeIntent, pendingWorkspaceEntry);
  // The attempt id is known as soon as the pending entry exists, well before
  // (or even absent) a resolved workspaceId — scoping on it here is what lets
  // a launch that fails before materializing still own only its own shell
  // instead of overriding every workspace's transcript (PRO-230).
  const attemptId = resolveLaunchIntentPendingAttemptId(activeIntent, pendingWorkspaceEntry);
  if (!workspaceId && !attemptId) {
    return;
  }

  useChatLaunchIntentStore.getState().markMaterializedIfActive(intentId, {
    ...(workspaceId ? { workspaceId } : {}),
    ...(attemptId ? { attemptId } : {}),
  });
}

export function homeLaunchFailureRetryMode(intentId: string): ChatLaunchRetryMode {
  const activeIntent = useChatLaunchIntentStore.getState().activeIntent;
  if (!activeIntent || activeIntent.id !== intentId) {
    return "safe";
  }

  const retryMode = resolveChatLaunchRetryMode(activeIntent);
  if (retryMode !== "safe") {
    return retryMode;
  }

  return resolveLaunchIntentPendingWorkspaceId(
    activeIntent,
    useSessionSelectionStore.getState().pendingWorkspaceEntry,
  )
    ? "manual_after_workspace"
    : "safe";
}
