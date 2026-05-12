import { useCallback } from "react";
import { resetWorkspaceEditorState } from "@/stores/editor/workspace-editor-state";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useChatInputStore } from "@/stores/chat/chat-input-store";
import { buildWorkspaceArrivalEvent } from "@/lib/domain/workspaces/creation/arrival";
import {
  type PendingWorkspaceEntry,
  type PendingWorkspaceInitialSession,
  buildPendingWorkspaceUiKey,
} from "@/lib/domain/workspaces/creation/pending-entry";
import { useWorkspaceSelection } from "@/hooks/workspaces/selection/use-workspace-selection";
import {
  ensureRepoGroupExpanded,
} from "@/stores/preferences/workspace-ui-store";
import {
  elapsedSince,
  logLatency,
} from "@/lib/infra/measurement/debug-latency";
import {
  usePendingWorkspaceSessionMaterialization,
} from "@/hooks/workspaces/workflows/use-pending-workspace-session-materialization";
import { useConfiguredLaunchReadiness } from "@/hooks/chat/derived/use-configured-launch-readiness";
import {
  ensurePendingWorkspaceSessionShell,
} from "@/hooks/workspaces/workflows/pending-workspace-session-shell";
import { writeChatShellIntentForSession } from "@/hooks/workspaces/tabs/workspace-shell-intent-writer";
import { getSessionRecord } from "@/stores/sessions/session-records";

interface FinalizeSelectionOptions {
  latencyFlowId?: string | null;
  repoGroupKeyToExpand?: string | null;
}

interface BeginPendingWorkspaceOptions {
  initialSession?: PendingWorkspaceInitialSession | null;
}

function isAttemptCurrent(attemptId: string): boolean {
  return useSessionSelectionStore.getState().pendingWorkspaceEntry?.attemptId === attemptId;
}

function requestChatInputFocus(): void {
  useChatInputStore.getState().requestFocus();
}

export function useWorkspaceEntryFlow() {
  const { selectWorkspace } = useWorkspaceSelection();
  const configuredLaunch = useConfiguredLaunchReadiness();
  const materializePendingWorkspaceSessions = usePendingWorkspaceSessionMaterialization();
  const enterPendingWorkspaceShell = useSessionSelectionStore(
    (state) => state.enterPendingWorkspaceShell,
  );
  const setPendingWorkspaceEntry = useSessionSelectionStore(
    (state) => state.setPendingWorkspaceEntry,
  );
  const setWorkspaceArrivalEvent = useSessionSelectionStore(
    (state) => state.setWorkspaceArrivalEvent,
  );

  const beginPendingWorkspace = useCallback((
    entry: PendingWorkspaceEntry,
    options?: BeginPendingWorkspaceOptions,
  ): string | null => {
    const initialSession = options?.initialSession === undefined
      ? configuredLaunch.selection
        ? {
          kind: "session" as const,
          agentKind: configuredLaunch.selection.kind,
          modelId: configuredLaunch.selection.modelId,
          displayTitle: configuredLaunch.displayName ?? configuredLaunch.selection.modelId,
        }
        : null
      : options.initialSession;
    const projectedSessionId = ensurePendingWorkspaceSessionShell({
      entry,
      initialSession: initialSession ?? null,
    });
    logLatency("workspace.entry.pending_shell", {
      attemptId: entry.attemptId,
      source: entry.source,
      requestKind: entry.request.kind,
      displayName: entry.displayName,
      repoLabel: entry.repoLabel,
      baseBranchName: entry.baseBranchName,
      originKind: entry.originTarget.kind,
      projectedSessionId,
    });
    resetWorkspaceEditorState();
    enterPendingWorkspaceShell(entry, {
      initialActiveSessionId: projectedSessionId,
    });
    if (projectedSessionId) {
      writeChatShellIntentForSession({
        workspaceId: buildPendingWorkspaceUiKey(entry),
        sessionId: projectedSessionId,
      });
    }
    requestChatInputFocus();
    return projectedSessionId;
  }, [configuredLaunch.displayName, configuredLaunch.selection, enterPendingWorkspaceShell]);

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

    const pendingWorkspaceUiKey = buildPendingWorkspaceUiKey(entry);
    const currentActiveSessionId = useSessionSelectionStore.getState().activeSessionId;
    const projectedActiveSessionId = currentActiveSessionId
      && getSessionRecord(currentActiveSessionId)?.workspaceId === pendingWorkspaceUiKey
      ? currentActiveSessionId
      : null;

    await selectWorkspace(workspaceId, {
      force: true,
      preservePending: true,
      initialActiveSessionId: projectedActiveSessionId,
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

    materializePendingWorkspaceSessions(entry, workspaceId);

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
  }, [
    materializePendingWorkspaceSessions,
    selectWorkspace,
    setPendingWorkspaceEntry,
    setWorkspaceArrivalEvent,
  ]);

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
