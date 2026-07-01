import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { DebugProfiler } from "@/components/diagnostics/DebugProfiler";
import { useActiveTranscriptPaneState } from "@/hooks/chat/derived/use-active-session-transcript-state";
import { useDebugRenderCount } from "@/hooks/ui/debug/use-debug-render-count";
import { MessageList } from "@/components/workspace/chat/transcript/MessageList";
import { ConnectedPlanHandoffDialog } from "@/components/workspace/chat/plans/ConnectedPlanHandoffDialog";
import { usePlanHandoffDialogState } from "@/hooks/plans/ui/use-plan-handoff-dialog-state";
import { useSessionHistoryHydration } from "@/hooks/sessions/lifecycle/use-session-history-hydration";
import { useWorkspaceShellActivation } from "@/hooks/workspaces/workflows/tabs/use-workspace-shell-activation";
import { useWorkspaceActivationWorkflow } from "@/hooks/workspaces/workflows/use-workspace-activation-workflow";
import { useWorkspaces } from "@/hooks/workspaces/cache/use-workspaces";
import { useCoworkManagedWorkspaces } from "@/hooks/access/anyharness/cowork/use-cowork-managed-workspaces";
import { TranscriptSwitchingPlaceholder } from "@/components/workspace/chat/surface/TranscriptSwitchingPlaceholder";
import {
  resolveTranscriptOpenSessionWorkspaceId,
  type TranscriptOpenSessionRole,
} from "@proliferate/product-domain/chats/transcript/transcript-open-target";
import { parseCloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud/cloud-ids";
import { logLatency } from "@/lib/infra/measurement/debug-latency";
import {
  ensureSessionTranscriptEntry,
  getSessionRecord,
  getSessionRecords,
  patchSessionRecord,
} from "@/stores/sessions/session-records";
import { useSessionDirectoryStore } from "@/stores/sessions/session-directory-store";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";

interface SessionTranscriptPaneProps {
  bottomInsetPx: number;
}

const OLDER_SESSION_HISTORY_EVENT_BUDGET = 1_500;
const OLDER_SESSION_HISTORY_TURN_LIMIT = 20;
const OLDER_SESSION_HISTORY_TIMEOUT_MS = 60_000;

export function SessionTranscriptPane({ bottomInsetPx }: SessionTranscriptPaneProps) {
  useDebugRenderCount("session-transcript-pane");
  const selectedWorkspaceId = useSessionSelectionStore((state) => state.selectedWorkspaceId);
  const handoff = usePlanHandoffDialogState();
  const { activateChatTab } = useWorkspaceShellActivation();
  const { openWorkspaceSession } = useWorkspaceActivationWorkflow();
  const { rehydrateSessionSlotFromHistory } = useSessionHistoryHydration();
  const { data: workspaceCollections } = useWorkspaces();
  const [olderHistoryLoadingSessionId, setOlderHistoryLoadingSessionId] = useState<string | null>(null);
  const immediatePaneState = useActiveTranscriptPaneState();
  const deferredPaneState = useDeferredValue(immediatePaneState);
  const transcriptDeferred =
    deferredPaneState.activeSessionId !== immediatePaneState.activeSessionId;
  const activeSessionId = transcriptDeferred
    ? null
    : deferredPaneState.activeSessionId;
  // The transcript renders from the deferred snapshot, so every input the
  // row model derives rows from must come from the same snapshot. Mixing
  // immediate outbox/optimistic state with a deferred transcript opens a
  // window where a prompt's outbox row is already tombstoned while its
  // transcript echo hasn't rendered yet — the message disappears for a
  // frame and the transcript visibly jumps.
  //
  // The optimistic prompt is the one exception, in the APPEARING direction
  // only: a just-sent message must render on the very next frame, and the
  // deferred snapshot can lag behind while streaming renders hog the main
  // thread. Union of both snapshots keeps each edge safe — appearance comes
  // from the immediate value, while clearing still waits for the deferred
  // snapshot whose transcript already contains the echoed turn.
  const optimisticPrompt = transcriptDeferred
    ? null
    : immediatePaneState.optimisticPrompt ?? deferredPaneState.optimisticPrompt;
  const outboxEntries = transcriptDeferred
    ? []
    : deferredPaneState.outboxEntries;
  const transcript = transcriptDeferred
    ? null
    : deferredPaneState.transcript;
  const sessionViewState = transcriptDeferred
    ? "idle"
    : deferredPaneState.sessionViewState;
  const oldestLoadedEventSeq = transcriptDeferred
    ? null
    : deferredPaneState.oldestLoadedEventSeq;
  const selectedWorkspace = useMemo(
    () => selectedWorkspaceId
      ? workspaceCollections?.allWorkspaces.find((workspace) => workspace.id === selectedWorkspaceId) ?? null
      : null,
    [selectedWorkspaceId, workspaceCollections?.allWorkspaces],
  );
  const selectedCloudWorkspace = useMemo(() => {
    const cloudWorkspaceId = parseCloudWorkspaceSyntheticId(selectedWorkspaceId);
    return cloudWorkspaceId
      ? workspaceCollections?.cloudWorkspaces.find((workspace) => workspace.id === cloudWorkspaceId) ?? null
      : null;
  }, [selectedWorkspaceId, workspaceCollections?.cloudWorkspaces]);
  const hasCoworkCodingCompletions = useMemo(
    () => transcript
      ? Object.values(transcript.linkCompletionsByCompletionId).some(
      (completion) => completion.relation === "cowork_coding_session",
    )
      : false,
    [transcript],
  );
  const { workspaces: coworkManagedWorkspaces } = useCoworkManagedWorkspaces(
    activeSessionId,
    hasCoworkCodingCompletions,
  );
  const linkedSessionWorkspaces = useMemo(() => {
    const entries = coworkManagedWorkspaces.flatMap((workspace) =>
      workspace.sessions.map((session) => [session.codingSessionId, workspace.workspaceId] as const)
    );
    return Object.fromEntries(entries);
  }, [coworkManagedWorkspaces]);
  const hasOlderHistory = oldestLoadedEventSeq !== null && oldestLoadedEventSeq > 1;
  const isLoadingOlderHistory = olderHistoryLoadingSessionId === activeSessionId;

  useEffect(() => {
    if (!activeSessionId || transcript) {
      return;
    }

    const directoryEntry =
      useSessionDirectoryStore.getState().entriesById[activeSessionId] ?? null;
    if (!directoryEntry) {
      return;
    }

    const selectionNonce = useSessionSelectionStore.getState().workspaceSelectionNonce;
    const workspaceIdAtStart = selectedWorkspaceId;
    ensureSessionTranscriptEntry(activeSessionId);
    void rehydrateSessionSlotFromHistory(activeSessionId, {
      replace: true,
      isCurrent: () => {
        const state = useSessionSelectionStore.getState();
        return state.workspaceSelectionNonce === selectionNonce
          && state.activeSessionId === activeSessionId
          && state.selectedWorkspaceId === workspaceIdAtStart;
      },
    }).finally(() => {
      const state = useSessionSelectionStore.getState();
      if (
        state.workspaceSelectionNonce === selectionNonce
        && state.activeSessionId === activeSessionId
        && state.selectedWorkspaceId === workspaceIdAtStart
      ) {
        patchSessionRecord(activeSessionId, { transcriptHydrated: true });
      }
    });
  }, [
    activeSessionId,
    rehydrateSessionSlotFromHistory,
    selectedWorkspaceId,
    transcript,
  ]);

  const loadOlderHistory = useCallback(() => {
    if (!activeSessionId || !selectedWorkspaceId || !hasOlderHistory || isLoadingOlderHistory) {
      return;
    }

    const selectionNonce = useSessionSelectionStore.getState().workspaceSelectionNonce;
    setOlderHistoryLoadingSessionId(activeSessionId);
    logLatency("session.history.older_chunk.requested", {
      sessionId: activeSessionId,
      workspaceId: selectedWorkspaceId,
      oldestLoadedEventSeq,
    });
    void rehydrateSessionSlotFromHistory(activeSessionId, {
      beforeSeq: oldestLoadedEventSeq ?? undefined,
      limit: OLDER_SESSION_HISTORY_EVENT_BUDGET,
      turnLimit: OLDER_SESSION_HISTORY_TURN_LIMIT,
      timeoutMs: OLDER_SESSION_HISTORY_TIMEOUT_MS,
      isCurrent: () => {
        const state = useSessionSelectionStore.getState();
        return state.workspaceSelectionNonce === selectionNonce
          && state.activeSessionId === activeSessionId
          && state.selectedWorkspaceId === selectedWorkspaceId;
      },
    }).then((loaded) => {
      logLatency("session.history.older_chunk.completed", {
        sessionId: activeSessionId,
        workspaceId: selectedWorkspaceId,
        loaded,
      });
    }).finally(() => {
      setOlderHistoryLoadingSessionId((currentSessionId) =>
        currentSessionId === activeSessionId ? null : currentSessionId,
      );
    });
  }, [
    activeSessionId,
    hasOlderHistory,
    isLoadingOlderHistory,
    oldestLoadedEventSeq,
    rehydrateSessionSlotFromHistory,
    selectedWorkspaceId,
  ]);

  const resolveOpenSessionWorkspaceId = useCallback((
    sessionId: string,
    role: TranscriptOpenSessionRole = "generic",
  ) => {
    const activeRecord = activeSessionId ? getSessionRecord(activeSessionId) : null;
    return resolveTranscriptOpenSessionWorkspaceId({
      sessionId,
      role,
      sessionSlots: getSessionRecords(),
      fallbackWorkspaceId: activeSessionId
        ? activeRecord?.workspaceId ?? selectedWorkspaceId
        : selectedWorkspaceId,
      linkedSessionWorkspaces,
      contextWorkspaces: [selectedWorkspace, selectedCloudWorkspace],
    });
  }, [
    activeSessionId,
    linkedSessionWorkspaces,
    selectedCloudWorkspace,
    selectedWorkspace,
    selectedWorkspaceId,
  ]);

  const canOpenTranscriptSession = useCallback((
    sessionId: string,
    role: TranscriptOpenSessionRole = "generic",
  ) => resolveOpenSessionWorkspaceId(sessionId, role) !== null, [resolveOpenSessionWorkspaceId]);

  const openTranscriptSession = useCallback((
    sessionId: string,
    role: TranscriptOpenSessionRole = "generic",
  ) => {
    const workspaceId = resolveOpenSessionWorkspaceId(sessionId, role);
    if (!workspaceId) return;

    const currentWorkspaceId = useSessionSelectionStore.getState().selectedWorkspaceId;
    if (workspaceId === currentWorkspaceId) {
      void activateChatTab({
        workspaceId,
        sessionId,
        source: "session-transcript-pane",
      });
      return;
    }

    void openWorkspaceSession({
      workspaceId,
      sessionId,
    });
  }, [
    activateChatTab,
    openWorkspaceSession,
    resolveOpenSessionWorkspaceId,
  ]);

  if (transcriptDeferred) {
    return <TranscriptSwitchingPlaceholder label="Switching chat" />;
  }

  if (!activeSessionId) {
    return null;
  }

  if (!transcript) {
    return <TranscriptSwitchingPlaceholder label="Loading chat" />;
  }

  return (
    <DebugProfiler id="session-transcript-pane">
      <MessageList
        activeSessionId={activeSessionId}
        selectedWorkspaceId={selectedWorkspaceId}
        optimisticPrompt={optimisticPrompt}
        outboxEntries={outboxEntries}
        transcript={transcript}
        sessionViewState={sessionViewState}
        hasOlderHistory={hasOlderHistory}
        isLoadingOlderHistory={isLoadingOlderHistory}
        olderHistoryCursor={oldestLoadedEventSeq}
        bottomInsetPx={bottomInsetPx}
        onLoadOlderHistory={loadOlderHistory}
        onHandOffPlanToNewSession={handoff.open}
        onOpenSession={openTranscriptSession}
        canOpenSession={canOpenTranscriptSession}
      />
      {handoff.plan && (
        <ConnectedPlanHandoffDialog
          plan={handoff.plan}
          onClose={handoff.close}
        />
      )}
    </DebugProfiler>
  );
}
