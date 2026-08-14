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

export interface WorkspaceEntryFinalizationResult {
  /** The launch pipeline ran to completion (the attempt was never dismissed). */
  committed: boolean;
  /** The user was attending this attempt, so selection moved to the workspace. */
  selected: boolean;
}

export interface WorkspaceEntrySelectionDeps {
  expandRepoGroup: (repoGroupKey: string) => void;
  getSessionRecord: (sessionId: string) => SessionRuntimeRecord | null;
  getSelectionState: () => {
    activeSessionId: string | null;
  };
  isAttemptAttended: (attemptId: string) => boolean;
  isAttemptLive: (attemptId: string) => boolean;
  materializePendingWorkspaceSessions: (
    entry: PendingWorkspaceEntry,
    workspaceId: string,
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
  setPendingWorkspaceEntry: (entry: PendingWorkspaceEntry) => void;
  clearPendingWorkspaceEntry: (attemptId: string) => void;
  setWorkspaceArrivalEvent: (event: ReturnType<typeof buildWorkspaceArrivalEvent>) => void;
  trackWorkspaceInteraction: (workspaceId: string) => void;
}

const DISMISSED_RESULT: WorkspaceEntryFinalizationResult = {
  committed: false,
  selected: false,
};

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
): Promise<WorkspaceEntryFinalizationResult> {
  const selectionStartedAt = startLatencyTimer();
  logLatency("workspace.entry.selection.start", {
    attemptId: input.entry.attemptId,
    source: input.entry.source,
    workspaceId: input.workspaceId,
    elapsedSincePendingMs: elapsedSince(input.entry.createdAt),
  });

  if (!deps.isAttemptLive(input.entry.attemptId)) {
    return DISMISSED_RESULT;
  }

  // Attention is read once: the force-selection below moves selection onto the
  // real workspace, which would make every later read look attended.
  const attended = deps.isAttemptAttended(input.entry.attemptId);

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

  if (attended) {
    await deps.selectWorkspace(input.workspaceId, {
      force: true,
      preservePending: true,
      initialActiveSessionId: projectedActiveSessionId,
      latencyFlowId: input.options?.latencyFlowId,
      knownWorkspace: input.options?.knownWorkspace ?? null,
    });
  }

  if (!deps.isAttemptLive(input.entry.attemptId)) {
    logLatency("workspace.entry.selection.stale", {
      attemptId: input.entry.attemptId,
      source: input.entry.source,
      workspaceId: input.workspaceId,
      selectionElapsedMs: elapsedMs(selectionStartedAt),
    });
    return DISMISSED_RESULT;
  }

  deps.materializePendingWorkspaceSessions(input.entry, input.workspaceId);

  if (attended) {
    deps.setWorkspaceArrivalEvent(buildWorkspaceArrivalEvent({
      workspaceId: input.workspaceId,
      source: input.entry.source,
      receiptClientSessionId: projectedActiveSessionId,
      setupScript: input.entry.setupScript,
      baseBranchName: input.entry.baseBranchName,
    }));
  }
  deps.trackWorkspaceInteraction(input.workspaceId);
  deps.clearPendingWorkspaceEntry(input.entry.attemptId);
  logLatency("workspace.entry.selection.success", {
    attemptId: input.entry.attemptId,
    source: input.entry.source,
    workspaceId: input.workspaceId,
    attended,
    selectionElapsedMs: elapsedMs(selectionStartedAt),
    totalElapsedMs: elapsedSince(input.entry.createdAt),
  });
  return { committed: true, selected: attended };
}

export function failPendingWorkspaceEntry(
  input: {
    entry: PendingWorkspaceEntry;
    errorMessage: string;
    overrides?: Partial<Pick<PendingWorkspaceEntry, "workspaceId" | "request" | "setupScript">>;
  },
  deps: Pick<WorkspaceEntrySelectionDeps, "isAttemptLive" | "setPendingWorkspaceEntry">,
): void {
  if (!deps.isAttemptLive(input.entry.attemptId)) {
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
