import {
  buildWorkspaceArrivalEvent,
} from "@/lib/domain/workspaces/creation/arrival";
import {
  buildPendingWorkspaceUiKey,
  type PendingWorkspaceEntry,
} from "@/lib/domain/workspaces/creation/pending-entry";
import {
  annotateLatencyFlow,
} from "@/lib/infra/measurement/latency-flow";
import {
  elapsedMs,
  elapsedSince,
  logLatency,
  startLatencyTimer,
} from "@/lib/infra/measurement/debug-latency";
import type { SessionRuntimeRecord } from "@/stores/sessions/session-types";

export interface WorkspaceEntrySelectionDeps {
  expandRepoGroup: (repoGroupKey: string) => void;
  getSessionRecord: (sessionId: string) => SessionRuntimeRecord | null;
  getSelectionState: () => {
    activeSessionId: string | null;
    pendingWorkspaceEntry: PendingWorkspaceEntry | null;
  };
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
    },
  ) => Promise<void>;
  setPendingWorkspaceEntry: (entry: PendingWorkspaceEntry | null) => void;
  setWorkspaceArrivalEvent: (event: ReturnType<typeof buildWorkspaceArrivalEvent>) => void;
  trackWorkspaceInteraction: (workspaceId: string) => void;
}

export async function finalizePendingWorkspaceSelection(
  input: {
    entry: PendingWorkspaceEntry;
    workspaceId: string;
    options?: {
      latencyFlowId?: string | null;
      repoGroupKeyToExpand?: string | null;
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
