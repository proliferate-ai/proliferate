import { useCallback } from "react";
import { useWorkspaceFilesStore } from "@/stores/editor/workspace-files-store";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { buildWorkspaceArrivalEvent } from "@/lib/domain/workspaces/arrival";
import type { PendingWorkspaceEntry } from "@/lib/domain/workspaces/pending-entry";
import { useWorkspaceSelection } from "@/hooks/workspaces/selection/use-workspace-selection";
import { ensureRepoGroupExpanded } from "@/stores/preferences/workspace-ui-store";
import {
  elapsedSince,
  logLatency,
} from "@/lib/infra/debug-latency";

function isAttemptCurrent(attemptId: string): boolean {
  return useHarnessStore.getState().pendingWorkspaceEntry?.attemptId === attemptId;
}

export function useWorkspaceEntryFlow() {
  const { selectWorkspace } = useWorkspaceSelection();
  const enterPendingWorkspaceShell = useHarnessStore(
    (state) => state.enterPendingWorkspaceShell,
  );
  const setPendingWorkspaceEntry = useHarnessStore(
    (state) => state.setPendingWorkspaceEntry,
  );
  const setWorkspaceArrivalEvent = useHarnessStore(
    (state) => state.setWorkspaceArrivalEvent,
  );

  const beginPendingWorkspace = useCallback((entry: PendingWorkspaceEntry) => {
    logLatency("workspace.entry.pending_shell", {
      attemptId: entry.attemptId,
      source: entry.source,
      requestKind: entry.request.kind,
      displayName: entry.displayName,
      repoLabel: entry.repoLabel,
      baseBranchName: entry.baseBranchName,
      originKind: entry.originTarget.kind,
    });
    useWorkspaceFilesStore.getState().reset();
    enterPendingWorkspaceShell(entry);
  }, [enterPendingWorkspaceShell]);

  const finalizeSelection = useCallback(async (
    entry: PendingWorkspaceEntry,
    workspaceId: string,
  ) => {
    logLatency("workspace.entry.selection.start", {
      attemptId: entry.attemptId,
      source: entry.source,
      workspaceId,
      elapsedSincePendingMs: elapsedSince(entry.createdAt),
    });

    setPendingWorkspaceEntry({
      ...entry,
      workspaceId,
      request: { kind: "select-existing", workspaceId },
      errorMessage: null,
    });

    await selectWorkspace(workspaceId, {
      force: true,
      preservePending: true,
    });

    if (!isAttemptCurrent(entry.attemptId)) {
      logLatency("workspace.entry.selection.stale", {
        attemptId: entry.attemptId,
        source: entry.source,
        workspaceId,
      });
      return;
    }

    setWorkspaceArrivalEvent(buildWorkspaceArrivalEvent({
      workspaceId,
      source: entry.source,
      setupScript: entry.setupScript,
      baseBranchName: entry.baseBranchName,
    }));
    setPendingWorkspaceEntry(null);
    logLatency("workspace.entry.selection.success", {
      attemptId: entry.attemptId,
      source: entry.source,
      workspaceId,
      totalElapsedMs: elapsedSince(entry.createdAt),
    });
  }, [selectWorkspace, setPendingWorkspaceEntry, setWorkspaceArrivalEvent]);

  const failPendingEntry = useCallback((
    entry: PendingWorkspaceEntry,
    errorMessage: string,
    overrides?: Partial<Pick<PendingWorkspaceEntry, "workspaceId" | "request" | "setupScript">>,
  ) => {
    if (!isAttemptCurrent(entry.attemptId)) {
      return;
    }

    logLatency("workspace.entry.failed", {
      attemptId: entry.attemptId,
      source: entry.source,
      workspaceId: overrides?.workspaceId ?? entry.workspaceId,
      errorMessage,
      elapsedSincePendingMs: elapsedSince(entry.createdAt),
    });
    setPendingWorkspaceEntry({
      ...entry,
      stage: "failed",
      errorMessage,
      workspaceId: overrides?.workspaceId ?? entry.workspaceId,
      request: overrides?.request ?? entry.request,
      setupScript: overrides?.setupScript ?? entry.setupScript,
    });
  }, [setPendingWorkspaceEntry]);

  const selectWorkspaceWithArrival = useCallback(async (input: {
    workspaceId: string;
    source: PendingWorkspaceEntry["source"];
    setupScript?: PendingWorkspaceEntry["setupScript"];
    baseBranchName?: string | null;
    repoGroupKeyToExpand?: string | null;
  }) => {
    if (input.repoGroupKeyToExpand) {
      ensureRepoGroupExpanded(input.repoGroupKeyToExpand);
    }
    setWorkspaceArrivalEvent(buildWorkspaceArrivalEvent({
      workspaceId: input.workspaceId,
      source: input.source,
      setupScript: input.setupScript ?? null,
      baseBranchName: input.baseBranchName ?? null,
    }));
    await selectWorkspace(input.workspaceId, { force: true });
  }, [selectWorkspace, setWorkspaceArrivalEvent]);

  return {
    beginPendingWorkspace,
    failPendingEntry,
    finalizeSelection,
    isAttemptCurrent,
    selectWorkspaceWithArrival,
  };
}
