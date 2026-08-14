import {
  resolveChatLaunchRetryMode,
  resolveLaunchIntentPendingAttemptId,
  resolveLaunchIntentPendingWorkspaceId,
  type ChatLaunchRetryMode,
} from "#product/lib/domain/chat/launch/launch-intent";
import { launchIntent } from "#product/lib/domain/chat/launch/launch-intent-registry";
import type { HomeLaunchTarget, HomeNextModelSelection } from "#product/lib/domain/home/home-next-launch";
import type {
  PendingWorkspaceEntry,
  PendingWorkspaceInitialSession,
} from "#product/lib/domain/workspaces/creation/pending-entry";
import {
  resolveAttendedPendingWorkspaceEntry,
} from "#product/lib/domain/workspaces/creation/pending-attention";
import {
  pendingWorkspaceEntry,
} from "#product/lib/domain/workspaces/creation/pending-entry-registry";
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

export function markHomeLaunchIntentMaterializedFromPendingWorkspace(
  intentId: string,
  launchAttemptId?: string | null,
): void {
  const intent = launchIntent(useChatLaunchIntentStore.getState(), intentId);
  if (!intent) {
    return;
  }

  const pendingEntry = resolveLaunchPendingWorkspaceEntry(launchAttemptId);
  const workspaceId = resolveLaunchIntentPendingWorkspaceId(intent, pendingEntry);
  // The attempt id is known as soon as the pending entry exists, well before
  // (or even absent) a resolved workspaceId — scoping on it here is what lets
  // a launch that fails before materializing still own only its own shell
  // instead of overriding every workspace's transcript (PRO-230).
  const attemptId = resolveLaunchIntentPendingAttemptId(intent, pendingEntry);
  if (!workspaceId && !attemptId) {
    return;
  }

  useChatLaunchIntentStore.getState().markMaterialized(intentId, {
    ...(workspaceId ? { workspaceId } : {}),
    ...(attemptId ? { attemptId } : {}),
  });
}

export function homeLaunchFailureRetryMode(
  intentId: string,
  launchAttemptId?: string | null,
): ChatLaunchRetryMode {
  const intent = launchIntent(useChatLaunchIntentStore.getState(), intentId);
  if (!intent) {
    return "safe";
  }

  const retryMode = resolveChatLaunchRetryMode(intent);
  if (retryMode !== "safe") {
    return retryMode;
  }

  return resolveLaunchIntentPendingWorkspaceId(
    intent,
    resolveLaunchPendingWorkspaceEntry(launchAttemptId),
  )
    ? "manual_after_workspace"
    : "safe";
}

/**
 * A launch owns its own attempt. Only a launch that never minted one (cowork,
 * cloud) falls back to whatever attempt the user is currently attending.
 */
function resolveLaunchPendingWorkspaceEntry(
  launchAttemptId?: string | null,
): PendingWorkspaceEntry | null {
  const selection = useSessionSelectionStore.getState();
  if (launchAttemptId) {
    return pendingWorkspaceEntry(selection.pendingWorkspaces, launchAttemptId);
  }
  return resolveAttendedPendingWorkspaceEntry(selection.pendingWorkspaces, {
    selectedLogicalWorkspaceId: selection.selectedLogicalWorkspaceId,
    selectedWorkspaceId: selection.selectedWorkspaceId,
  });
}
