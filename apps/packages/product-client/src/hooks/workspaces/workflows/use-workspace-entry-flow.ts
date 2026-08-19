import { useCallback } from "react";
import { resetWorkspaceEditorState } from "#product/stores/editor/workspace-editor-state";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import { useChatInputStore } from "#product/stores/chat/chat-input-store";
import { useUserPreferencesStore } from "#product/stores/preferences/user-preferences-store";
import { buildWorkspaceArrivalEvent } from "#product/lib/domain/workspaces/creation/arrival";
import {
  type PendingWorkspaceEntry,
  type PendingWorkspaceInitialSession,
  buildPendingWorkspaceUiKey,
} from "#product/lib/domain/workspaces/creation/pending-entry";
import { useWorkspaceSelection } from "#product/hooks/workspaces/workflows/selection/use-workspace-selection";
import {
  ensureRepoGroupExpanded,
  useWorkspaceUiStore,
} from "#product/stores/preferences/workspace-ui-store";
import {
  elapsedSince,
  logLatency,
} from "#product/lib/infra/measurement/measurement-port";
import {
  usePendingWorkspaceSessionMaterialization,
} from "#product/hooks/workspaces/workflows/use-pending-workspace-session-materialization";
import { useConfiguredLaunchReadiness } from "#product/hooks/chat/derived/use-configured-launch-readiness";
import {
  ensurePendingWorkspaceSessionShell,
} from "#product/hooks/workspaces/workflows/pending-workspace-session-shell";
import { writeChatShellIntentForSession } from "#product/hooks/workspaces/workflows/tabs/workspace-shell-intent-writer";
import { getSessionRecord } from "#product/stores/sessions/session-records";
import { useSessionDirectoryStore } from "#product/stores/sessions/session-directory-store";
import { batchSessionStoreWrites } from "#product/lib/infra/scheduling/react-batching";
import { buildPendingInitialSession } from "#product/hooks/workspaces/workflows/workspace-entry-action-helpers";
import {
  isAttemptAttended,
  isAttemptLive,
  patchAttempt,
} from "#product/hooks/workspaces/workflows/pending-workspace-attempt-access";
import {
  notifyUnattendedPendingWorkspaceFailure,
} from "#product/hooks/workspaces/workflows/pending-workspace-failure-notice";
import type {
  WorkspaceEntryFinalizationResult,
} from "#product/hooks/workspaces/workflows/workspace-entry-finalization";

interface FinalizeSelectionOptions {
  latencyFlowId?: string | null;
  repoGroupKeyToExpand?: string | null;
}

interface BeginPendingWorkspaceOptions {
  initialSession?: PendingWorkspaceInitialSession | null;
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
  const clearPendingWorkspaceEntry = useSessionSelectionStore(
    (state) => state.clearPendingWorkspaceEntry,
  );
  const setWorkspaceArrivalEvent = useSessionSelectionStore(
    (state) => state.setWorkspaceArrivalEvent,
  );

  const beginPendingWorkspace = useCallback((
    entry: PendingWorkspaceEntry,
    options?: BeginPendingWorkspaceOptions,
  ): string | null => {
    const preferences = useUserPreferencesStore.getState();
    const preferredAgentKind = preferences.defaultChatAgentKind;
    const preferredModelId = preferredAgentKind
      ? preferences.defaultChatModelIdByAgentKind[preferredAgentKind] ?? null
      : null;
    const activeSessionId = useSessionSelectionStore.getState().activeSessionId;
    const activeRecord = activeSessionId ? getSessionRecord(activeSessionId) : null;
    const initialSession = options?.initialSession === undefined
      ? buildPendingInitialSession({
        agentKind: configuredLaunch.selection?.kind,
        modelId: configuredLaunch.selection?.modelId,
        launchControlValues: configuredLaunch.selection?.kind
          ? preferences.defaultLiveSessionControlValuesByAgentKind[
            configuredLaunch.selection.kind
          ] ?? {}
          : {},
        displayTitle: configuredLaunch.displayName,
      }) ?? buildPendingInitialSession({
        agentKind: preferredAgentKind,
        modelId: preferredModelId,
        launchControlValues: preferredAgentKind
          ? preferences.defaultLiveSessionControlValuesByAgentKind[preferredAgentKind] ?? {}
          : {},
      }) ?? buildPendingInitialSession({
        agentKind: activeRecord?.agentKind ?? null,
        modelId: activeRecord?.modelId ?? null,
        launchControlValues: activeRecord?.liveConfig?.normalizedControls
          ? Object.fromEntries(Object.values(activeRecord.liveConfig.normalizedControls)
            .flatMap((value) => Array.isArray(value) ? value : value ? [value] : [])
            .map((control) => [control.rawConfigId, control.currentValue])
            .filter((entry): entry is [string, string] => Boolean(entry[1])))
          : {},
      })
      : options.initialSession;
    const pendingWorkspaceUiKey = buildPendingWorkspaceUiKey(entry);
    let projectedSessionId: string | null = null;
    batchSessionStoreWrites(() => {
      projectedSessionId = ensurePendingWorkspaceSessionShell({
        entry,
        initialSession: initialSession ?? null,
      });
      resetWorkspaceEditorState();
      if (projectedSessionId) {
        writeChatShellIntentForSession({
          workspaceId: pendingWorkspaceUiKey,
          shellWorkspaceId: pendingWorkspaceUiKey,
          sessionId: projectedSessionId,
        });
      }
      enterPendingWorkspaceShell(entry, {
        initialActiveSessionId: projectedSessionId,
      });
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
      pendingWorkspaceUiKey,
      selectedLogicalWorkspaceId: useSessionSelectionStore.getState().selectedLogicalWorkspaceId,
      activeSessionId: useSessionSelectionStore.getState().activeSessionId,
      storedActiveShellTabKey:
        useWorkspaceUiStore.getState().activeShellTabKeyByWorkspace[pendingWorkspaceUiKey] ?? null,
      directorySessionIds:
        useSessionDirectoryStore.getState().sessionIdsByWorkspaceId[pendingWorkspaceUiKey] ?? [],
    });
    requestChatInputFocus();
    return projectedSessionId;
  }, [
    configuredLaunch.displayName,
    configuredLaunch.selection,
    enterPendingWorkspaceShell,
  ]);

  const finalizeSelection = useCallback(async (
    entry: PendingWorkspaceEntry,
    workspaceId: string,
    options?: FinalizeSelectionOptions,
  ): Promise<WorkspaceEntryFinalizationResult> => {
    logLatency("workspace.entry.selection.start", {
      attemptId: entry.attemptId,
      source: entry.source,
      workspaceId,
      elapsedSincePendingMs: elapsedSince(entry.createdAt),
    });

    if (!isAttemptLive(entry.attemptId)) {
      return { committed: false, selected: false };
    }
    // Read attention before the force-selection below moves selection onto the
    // real workspace, which would make every later read look attended.
    const attended = isAttemptAttended(entry.attemptId);

    if (options?.repoGroupKeyToExpand) {
      ensureRepoGroupExpanded(options.repoGroupKeyToExpand);
    }

    setPendingWorkspaceEntry({
      ...entry,
      workspaceId,
      errorMessage: null,
    });

    const pendingWorkspaceUiKey = buildPendingWorkspaceUiKey(entry);
    const currentActiveSessionId = useSessionSelectionStore.getState().activeSessionId;
    const projectedActiveSessionId = currentActiveSessionId
      && getSessionRecord(currentActiveSessionId)?.workspaceId === pendingWorkspaceUiKey
      ? currentActiveSessionId
      : null;

    if (attended) {
      await selectWorkspace(workspaceId, {
        force: true,
        preservePending: true,
        initialActiveSessionId: projectedActiveSessionId,
        latencyFlowId: options?.latencyFlowId,
      });
    }

    if (!isAttemptLive(entry.attemptId)) {
      logLatency("workspace.entry.selection.stale", {
        attemptId: entry.attemptId,
        source: entry.source,
        workspaceId,
      });
      return { committed: false, selected: false };
    }

    // The attendance decision above governs materialization too, so the
    // arrival event and the session activation cannot disagree.
    materializePendingWorkspaceSessions(entry, workspaceId, { attended });

    if (attended) {
      setWorkspaceArrivalEvent(buildWorkspaceArrivalEvent({
        workspaceId,
        source: entry.source,
        receiptClientSessionId: projectedActiveSessionId,
        setupScript: entry.setupScript,
        baseBranchName: entry.baseBranchName,
      }));
    }
    clearPendingWorkspaceEntry(entry.attemptId);
    logLatency("workspace.entry.selection.success", {
      attemptId: entry.attemptId,
      source: entry.source,
      workspaceId,
      attended,
      totalElapsedMs: elapsedSince(entry.createdAt),
    });
    return { committed: true, selected: attended };
  }, [
    clearPendingWorkspaceEntry,
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
    if (!isAttemptLive(entry.attemptId)) {
      return;
    }

    logLatency("workspace.entry.failed", {
      attemptId: entry.attemptId,
      source: entry.source,
      workspaceId: overrides?.workspaceId ?? entry.workspaceId,
      errorMessage,
      elapsedSincePendingMs: elapsedSince(entry.createdAt),
    });
    patchAttempt(entry.attemptId, {
      ...entry,
      stage: "failed",
      errorMessage,
      workspaceId: overrides?.workspaceId ?? entry.workspaceId,
      request: overrides?.request ?? entry.request,
      setupScript: overrides?.setupScript ?? entry.setupScript,
    });
    notifyUnattendedPendingWorkspaceFailure(entry, errorMessage);
  }, []);

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
    selectWorkspaceWithArrival,
  };
}
