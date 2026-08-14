import {
  resolveChatLaunchRetryMode,
  resolveLaunchIntentPendingAttemptId,
  resolveLaunchIntentPendingWorkspaceId,
  type ChatLaunchIntent,
  type ChatLaunchRetryMode,
} from "#product/lib/domain/chat/launch/launch-intent";
import { launchIntent } from "#product/lib/domain/chat/launch/launch-intent-registry";
import type {
  HomeLaunchTarget,
  HomeNextLaunchOutcome,
  HomeNextModelSelection,
} from "#product/lib/domain/home/home-next-launch";
import {
  canBeginPendingLaunch,
  isDuplicateLaunchSubmit,
  type LaunchSubmitFingerprint,
} from "#product/lib/domain/workspaces/creation/launch-concurrency";
import type {
  PendingWorkspaceEntry,
  PendingWorkspaceInitialSession,
} from "#product/lib/domain/workspaces/creation/pending-entry";
import {
  resolveAttendedPendingWorkspaceEntry,
} from "#product/lib/domain/workspaces/creation/pending-attention";
import {
  pendingWorkspaceEntries,
  pendingWorkspaceEntry,
  type PendingWorkspaceRegistry,
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

/** Why a Home launch never started, and what to tell the user. */
export interface HomeNextLaunchRefusal {
  outcome: Extract<HomeNextLaunchOutcome, "refused" | "duplicate">;
  message: string | null;
}

/**
 * The preflight every Home launch passes before it takes a slot: an empty
 * prompt, a keystroke-duplicate submit, a Desktop-only target on the web, or
 * the concurrent-launch cap already being full. Returns `null` when the launch
 * may proceed (PRO-230).
 */
export function resolveHomeNextLaunchRefusal(input: {
  prompt: string;
  target: HomeLaunchTarget;
  submit: LaunchSubmitFingerprint;
  lastSubmit: LaunchSubmitFingerprint | null;
  desktopTargetsAvailable: boolean;
  pendingWorkspaces: PendingWorkspaceRegistry;
}): HomeNextLaunchRefusal | null {
  if (!input.prompt) {
    return { outcome: "refused", message: null };
  }
  if (isDuplicateLaunchSubmit(input.lastSubmit, input.submit)) {
    // The launch this collapsed into is running, so the prompt must not come
    // back to the composer as if nothing had happened.
    return { outcome: "duplicate", message: null };
  }
  if (!input.desktopTargetsAvailable && input.target.kind !== "cloud") {
    return {
      outcome: "refused",
      message: input.target.kind === "cowork"
        ? "Cowork threads are available in the Desktop app."
        : "Local launch targets are available in the Desktop app.",
    };
  }
  // Prompting an existing workspace starts no workspace, so it takes no launch
  // slot and the cap does not apply to it.
  const createsWorkspace = input.target.kind !== "local" || input.target.existingWorkspaceId === null;
  if (createsWorkspace && !canBeginPendingLaunch(pendingWorkspaceEntries(input.pendingWorkspaces))) {
    return { outcome: "refused", message: "Too many workspaces starting. Wait for one to finish." };
  }
  return null;
}

/** The ids and resolved inputs a started Home launch carries through its branches. */
export interface StartedHomeNextLaunch {
  launchIntentId: string;
  promptId: string;
  resolvedLaunchControlValues: Record<string, string>;
  initialSession: PendingWorkspaceInitialSession;
}

/**
 * Mints a Home launch's ids and registers its launch intent.
 *
 * The intent is what owns the composer surface until the launch materializes,
 * so it has to exist before any target branch runs. The pending-workspace
 * attempt does not exist yet — `markHomeLaunchIntentMaterializedFromPendingWorkspace`
 * threads it in once the branch mints one (PRO-230).
 */
export function beginHomeNextLaunch(
  begin: (intent: ChatLaunchIntent) => void,
  input: {
    prompt: string;
    modelSelection: HomeNextModelSelection;
    modeId: string | null;
    launchControlValues?: Record<string, string>;
    target: HomeLaunchTarget;
  },
): StartedHomeNextLaunch {
  const { prompt, modelSelection, modeId, target } = input;
  const launchIntentId = newHomeNextLaunchId();
  const promptId = newHomeNextLaunchId();
  const resolvedLaunchControlValues = buildResolvedHomeLaunchControlValues({
    modeId,
    launchControlValues: input.launchControlValues,
  });
  const initialSession = buildHomePendingWorkspaceInitialSession({
    modelSelection,
    modeId,
    launchControlValues: resolvedLaunchControlValues,
  });
  begin({
    id: launchIntentId,
    catalogSnapshotId: null,
    agentKind: modelSelection.kind,
    modelId: modelSelection.modelId,
    modeId,
    launchControlValues: resolvedLaunchControlValues,
    promptId,
    queuedPromptBlocks: [{ type: "text", text: prompt }],
    optimisticContentParts: [{ type: "text", text: prompt }],
    text: prompt,
    contentParts: [{ type: "text", text: prompt }],
    targetKind: target.kind,
    retryInput: {
      text: prompt,
      modelSelection,
      modeId,
      launchControlValues: resolvedLaunchControlValues,
      target,
    },
    materializedWorkspaceId: null,
    materializedSessionId: null,
    // The pending-workspace attempt (if any) isn't created until after this
    // intent begins; it gets threaded in once known via
    // markHomeLaunchIntentMaterializedFromPendingWorkspace.
    attemptId: null,
    targetWorkspaceId: target.kind === "local" ? target.existingWorkspaceId : null,
    createdAt: Date.now(),
    sendAttemptedAt: null,
    failure: null,
  });
  return { launchIntentId, promptId, resolvedLaunchControlValues, initialSession };
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
