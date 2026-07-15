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
import type { GoalTranscriptEvent } from "@proliferate/product-domain/activity/goal-transcript-events";
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
  nonDisplacingBottomInsetPx: number;
}

const OLDER_SESSION_HISTORY_EVENT_BUDGET = 1_500;
const OLDER_SESSION_HISTORY_TURN_LIMIT = 20;
const OLDER_SESSION_HISTORY_TIMEOUT_MS = 60_000;
const EMPTY_GOAL_EVENTS: readonly GoalTranscriptEvent[] = [];

export function SessionTranscriptPane({
  bottomInsetPx,
  nonDisplacingBottomInsetPx,
}: SessionTranscriptPaneProps) {
  useDebugRenderCount("session-transcript-pane");
  const selectedWorkspaceId = useSessionSelectionStore((state) => state.selectedWorkspaceId);
  const handoff = usePlanHandoffDialogState();
  const { activateChatTab } = useWorkspaceShellActivation();
  const { openWorkspaceSession } = useWorkspaceActivationWorkflow();
  const { rehydrateSessionSlotFromHistory } = useSessionHistoryHydration();
  const { data: workspaceCollections } = useWorkspaces();
  const [olderHistoryLoadingSessionId, setOlderHistoryLoadingSessionId] = useState<string | null>(null);
  const immediatePaneState = useActiveTranscriptPaneState();
  // STARVATION GUARD: only the session IDENTITY is deferred — never the
  // transcript content. Deferring the whole pane state meant every stream
  // batch restarted the in-flight deferred render; once per-batch renders got
  // heavier than the batch interval (full live-tail markdown re-parse after
  // the typewriter's removal), the deferred lane never committed and the
  // transcript froze on "Thinking…" until the stream ended.
  //
  // Session switches keep their interruptible heavy mount: while the deferred
  // id lags the immediate id, the pane renders a cheap placeholder urgently,
  // and the full transcript mounts inside the deferred lane when it flips.
  // Stream batches do not change the session id, so they cannot restart that
  // lane. All content fields read from ONE immediate snapshot, so
  // outbox/optimistic/transcript stay mutually consistent by construction.
  const deferredActiveSessionId = useDeferredValue(immediatePaneState.activeSessionId);
  const transcriptDeferred =
    deferredActiveSessionId !== immediatePaneState.activeSessionId;
  const activeSessionId = transcriptDeferred
    ? null
    : immediatePaneState.activeSessionId;
  const optimisticPrompt = transcriptDeferred
    ? null
    : immediatePaneState.optimisticPrompt;
  const outboxEntries = transcriptDeferred
    ? []
    : immediatePaneState.outboxEntries;
  const transcript = transcriptDeferred
    ? null
    : immediatePaneState.transcript;
  const goalEvents = transcriptDeferred
    ? EMPTY_GOAL_EVENTS
    : immediatePaneState.goalEvents;
  const sessionViewState = transcriptDeferred
    ? "idle"
    : immediatePaneState.sessionViewState;
  const oldestLoadedEventSeq = transcriptDeferred
    ? null
    : immediatePaneState.oldestLoadedEventSeq;
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
        goalEvents={goalEvents}
        sessionViewState={sessionViewState}
        hasOlderHistory={hasOlderHistory}
        isLoadingOlderHistory={isLoadingOlderHistory}
        olderHistoryCursor={oldestLoadedEventSeq}
        bottomInsetPx={bottomInsetPx}
        nonDisplacingBottomInsetPx={nonDisplacingBottomInsetPx}
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
