import { useCallback } from "react";
import { resetWorkspaceEditorState } from "@/stores/editor/workspace-editor-state";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useChatInputStore } from "@/stores/chat/chat-input-store";
import { buildWorkspaceArrivalEvent } from "@/lib/domain/workspaces/creation/arrival";
import type { PendingWorkspaceEntry } from "@/lib/domain/workspaces/creation/pending-entry";
import { useWorkspaceSelection } from "@/hooks/workspaces/selection/use-workspace-selection";
import {
  ensureRepoGroupExpanded,
} from "@/stores/preferences/workspace-ui-store";
import {
  elapsedSince,
  logLatency,
} from "@/lib/infra/measurement/debug-latency";

interface FinalizeSelectionOptions {
  latencyFlowId?: string | null;
  repoGroupKeyToExpand?: string | null;
}

function isAttemptCurrent(attemptId: string): boolean {
  return useSessionSelectionStore.getState().pendingWorkspaceEntry?.attemptId === attemptId;
}

function requestChatInputFocus(): void {
  useChatInputStore.getState().requestFocus();
}

export function useWorkspaceEntryFlow() {
  const { selectWorkspace } = useWorkspaceSelection();
  const enterPendingWorkspaceShell = useSessionSelectionStore(
    (state) => state.enterPendingWorkspaceShell,
  );
  const setPendingWorkspaceEntry = useSessionSelectionStore(
    (state) => state.setPendingWorkspaceEntry,
  );
  const setWorkspaceArrivalEvent = useSessionSelectionStore(
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
    resetWorkspaceEditorState();
    enterPendingWorkspaceShell(entry);
    requestChatInputFocus();
  }, [enterPendingWorkspaceShell]);

  const finalizeSelection = useCallback(async (
    entry: PendingWorkspaceEntry,
    workspaceId: string,
    options?: FinalizeSelectionOptions,
  ): Promise<boolean> => {
    logLatency("workspace.entry.selection.start", {
      attemptId: entry.attemptId,
      source: entry.source,
      workspaceId,
      elapsedSincePendingMs: elapsedSince(entry.createdAt),
    });

    if (options?.repoGroupKeyToExpand) {
      ensureRepoGroupExpanded(options.repoGroupKeyToExpand);
    }

    setPendingWorkspaceEntry({
      ...entry,
      workspaceId,
      request: { kind: "select-existing", workspaceId },
      errorMessage: null,
    });

    await selectWorkspace(workspaceId, {
      force: true,
      preservePending: true,
      latencyFlowId: options?.latencyFlowId,
    });

    if (!isAttemptCurrent(entry.attemptId)) {
      logLatency("workspace.entry.selection.stale", {
        attemptId: entry.attemptId,
        source: entry.source,
        workspaceId,
      });
      return false;
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
    return true;
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
    latencyFlowId?: string | null;
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
    requestChatInputFocus();
    await selectWorkspace(input.workspaceId, input.latencyFlowId
      ? { force: true, latencyFlowId: input.latencyFlowId }
      : { force: true });
  }, [selectWorkspace, setWorkspaceArrivalEvent]);

  return {
    beginPendingWorkspace,
    failPendingEntry,
    finalizeSelection,
    isAttemptCurrent,
    selectWorkspaceWithArrival,
  };
}
