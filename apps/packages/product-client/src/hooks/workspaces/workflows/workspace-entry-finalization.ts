import {
  buildWorkspaceArrivalEvent,
} from "#product/lib/domain/workspaces/creation/arrival";
import type { Workspace } from "@anyharness/sdk";
import {
  buildPendingWorkspaceUiKey,
  type PendingWorkspaceEntry,
} from "#product/lib/domain/workspaces/creation/pending-entry";
import {
  annotateLatencyFlow,
} from "#product/lib/infra/measurement/measurement-port";
import {
  elapsedMs,
  elapsedSince,
  logLatency,
  startLatencyTimer,
} from "#product/lib/infra/measurement/measurement-port";
import type { SessionRuntimeRecord } from "#product/stores/sessions/session-types";
import type { WorkspaceEntryResult } from "#product/hooks/workspaces/workflows/workspace-entry-types";

export interface WorkspaceEntrySelectionDeps {
  expandRepoGroup: (repoGroupKey: string) => void;
  getSessionRecord: (sessionId: string) => SessionRuntimeRecord | null;
  getSelectionState: () => {
    activeSessionId: string | null;
    pendingWorkspaceEntry: PendingWorkspaceEntry | null;
    selectedLogicalWorkspaceId: string | null;
  };
  materializePendingWorkspaceSessions: (
    entry: PendingWorkspaceEntry,
    workspaceId: string,
    options?: { eventPrefix?: string; skipSessionActivation?: boolean },
  ) => void;
  selectWorkspace: (
    workspaceId: string,
    options: {
      force: true;
      preservePending: true;
      initialActiveSessionId: string | null;
      latencyFlowId?: string | null;
      knownWorkspace?: Workspace | null;
    },
  ) => Promise<void>;
  setPendingWorkspaceEntry: (entry: PendingWorkspaceEntry | null) => void;
  setWorkspaceArrivalEvent: (event: ReturnType<typeof buildWorkspaceArrivalEvent>) => void;
  trackWorkspaceInteraction: (workspaceId: string, at?: string) => void;
}

export async function finalizePendingWorkspaceSelection(
  input: {
    entry: PendingWorkspaceEntry;
    workspaceId: string;
    options?: {
      latencyFlowId?: string | null;
      repoGroupKeyToExpand?: string | null;
      knownWorkspace?: Workspace | null;
    };
  },
  deps: WorkspaceEntrySelectionDeps,
): Promise<boolean> {
  const selectionStartedAt = startLatencyTimer();
  logLatency("workspace.entry.selection.start", {
    attemptId: input.entry.attemptId,
    source: input.entry.source,
    workspaceId: input.workspaceId,
    elapsedSincePendingMs: elapsedSince(input.entry.createdAt),
  });

  deps.setPendingWorkspaceEntry({
    ...input.entry,
    workspaceId: input.workspaceId,
    errorMessage: null,
  });
  annotateLatencyFlow(input.options?.latencyFlowId, {
    attemptId: input.entry.attemptId,
    targetWorkspaceId: input.workspaceId,
  });
  if (input.options?.repoGroupKeyToExpand) {
    deps.expandRepoGroup(input.options.repoGroupKeyToExpand);
  }

  const pendingWorkspaceUiKey = buildPendingWorkspaceUiKey(input.entry);
  const currentActiveSessionId = deps.getSelectionState().activeSessionId;
  const projectedActiveSessionId = currentActiveSessionId
    && deps.getSessionRecord(currentActiveSessionId)?.workspaceId === pendingWorkspaceUiKey
    ? currentActiveSessionId
    : null;

  await deps.selectWorkspace(input.workspaceId, {
    force: true,
    preservePending: true,
    initialActiveSessionId: projectedActiveSessionId,
    latencyFlowId: input.options?.latencyFlowId,
    knownWorkspace: input.options?.knownWorkspace ?? null,
  });

  if (!isPendingWorkspaceAttemptCurrent(input.entry.attemptId, deps)) {
    logLatency("workspace.entry.selection.stale", {
      attemptId: input.entry.attemptId,
      source: input.entry.source,
      workspaceId: input.workspaceId,
      selectionElapsedMs: elapsedMs(selectionStartedAt),
    });
    return false;
  }

  deps.materializePendingWorkspaceSessions(input.entry, input.workspaceId);

  deps.setWorkspaceArrivalEvent(buildWorkspaceArrivalEvent({
    workspaceId: input.workspaceId,
    source: input.entry.source,
    receiptClientSessionId: projectedActiveSessionId,
    setupScript: input.entry.setupScript,
    baseBranchName: input.entry.baseBranchName,
  }));
  deps.trackWorkspaceInteraction(input.workspaceId);
  deps.setPendingWorkspaceEntry(null);
  logLatency("workspace.entry.selection.success", {
    attemptId: input.entry.attemptId,
    source: input.entry.source,
    workspaceId: input.workspaceId,
    selectionElapsedMs: elapsedMs(selectionStartedAt),
    totalElapsedMs: elapsedSince(input.entry.createdAt),
  });
  return true;
}

/**
 * Finalization steals selection into the created workspace, so it is only
 * legitimate while this attempt's pending shell is still the selected
 * surface. A cleared or replaced attempt, or a selection the user moved
 * elsewhere, routes the completion through the background path instead.
 */
export function shouldFinalizePendingWorkspaceSelection(
  entry: PendingWorkspaceEntry,
  deps: Pick<WorkspaceEntrySelectionDeps, "getSelectionState">,
): boolean {
  const selection = deps.getSelectionState();
  return selection.pendingWorkspaceEntry?.attemptId === entry.attemptId
    && selection.selectedLogicalWorkspaceId === buildPendingWorkspaceUiKey(entry);
}

/**
 * A creation finished while the user was on another workspace. The created
 * workspace and its queued prompt survive: projected sessions bind to the
 * real workspace without stealing the selection the user moved to (PRO-230).
 */
export function completePendingWorkspaceCreationInBackground(
  input: {
    entry: PendingWorkspaceEntry;
    workspaceId: string;
    projectedSessionId: string | null;
  },
  deps: Pick<
    WorkspaceEntrySelectionDeps,
    | "getSelectionState"
    | "materializePendingWorkspaceSessions"
    | "setPendingWorkspaceEntry"
    | "trackWorkspaceInteraction"
  >,
): WorkspaceEntryResult {
  logLatency("workspace.entry.background_completion", {
    attemptId: input.entry.attemptId,
    source: input.entry.source,
    workspaceId: input.workspaceId,
    projectedSessionId: input.projectedSessionId,
    elapsedSincePendingMs: elapsedSince(input.entry.createdAt),
  });
  deps.materializePendingWorkspaceSessions(input.entry, input.workspaceId, {
    eventPrefix: "workspace.entry.background",
    skipSessionActivation: true,
  });
  // The sidebar slot the pending row held is keyed by the entry's creation
  // time; stamping the materialized id with that same instant hands the real
  // row the same slot instead of re-sorting it at completion.
  deps.trackWorkspaceInteraction(
    input.workspaceId,
    new Date(input.entry.createdAt).toISOString(),
  );
  if (deps.getSelectionState().pendingWorkspaceEntry?.attemptId === input.entry.attemptId) {
    deps.setPendingWorkspaceEntry(null);
  }
  return { workspaceId: input.workspaceId, projectedSessionId: input.projectedSessionId };
}

export function failPendingWorkspaceEntry(
  input: {
    entry: PendingWorkspaceEntry;
    errorMessage: string;
    overrides?: Partial<Pick<PendingWorkspaceEntry, "workspaceId" | "request" | "setupScript">>;
  },
  deps: Pick<WorkspaceEntrySelectionDeps, "getSelectionState" | "setPendingWorkspaceEntry">,
): void {
  if (!isPendingWorkspaceAttemptCurrent(input.entry.attemptId, deps)) {
    return;
  }

  logLatency("workspace.entry.failed", {
    attemptId: input.entry.attemptId,
    source: input.entry.source,
    workspaceId: input.overrides?.workspaceId ?? input.entry.workspaceId,
    errorMessage: input.errorMessage,
    elapsedSincePendingMs: elapsedSince(input.entry.createdAt),
  });
  deps.setPendingWorkspaceEntry({
    ...input.entry,
    stage: "failed",
    errorMessage: input.errorMessage,
    workspaceId: input.overrides?.workspaceId ?? input.entry.workspaceId,
    request: input.overrides?.request ?? input.entry.request,
    setupScript: input.overrides?.setupScript ?? input.entry.setupScript,
  });
}

function isPendingWorkspaceAttemptCurrent(
  attemptId: string,
  deps: Pick<WorkspaceEntrySelectionDeps, "getSelectionState">,
): boolean {
  return deps.getSelectionState().pendingWorkspaceEntry?.attemptId === attemptId;
}
