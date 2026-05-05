import { useCallback, useDeferredValue, useMemo, useState } from "react";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { DebugProfiler } from "@/components/ui/DebugProfiler";
import { useActiveTranscriptPaneState } from "@/hooks/chat/use-active-chat-session-selectors";
import { useDebugRenderCount } from "@/hooks/ui/use-debug-render-count";
import { useDebugValueChange } from "@/hooks/ui/use-debug-value-change";
import { MessageList } from "@/components/workspace/chat/transcript/MessageList";
import { ConnectedPlanHandoffDialog } from "@/components/workspace/chat/plans/ConnectedPlanHandoffDialog";
import { usePlanHandoffDialogState } from "@/hooks/plans/use-plan-handoff-dialog-state";
import { useSessionRuntimeActions } from "@/hooks/sessions/use-session-runtime-actions";
import { useWorkspaceShellActivation } from "@/hooks/workspaces/tabs/use-workspace-shell-activation";
import { useWorkspaceActivationWorkflow } from "@/hooks/workspaces/use-workspace-activation-workflow";
import { useWorkspaces } from "@/hooks/workspaces/use-workspaces";
import { useCoworkManagedWorkspaces } from "@/hooks/cowork/use-cowork-managed-workspaces";
import {
  resolveTranscriptOpenSessionWorkspaceId,
  type TranscriptOpenSessionRole,
} from "@/lib/domain/chat/transcript-open-target";
import { parseCloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud-ids";
import { logLatency } from "@/lib/infra/debug-latency";

interface SessionTranscriptPaneProps {
  bottomInsetPx: number;
}

const OLDER_SESSION_HISTORY_EVENT_BUDGET = 1_500;
const OLDER_SESSION_HISTORY_TURN_LIMIT = 20;
const OLDER_SESSION_HISTORY_TIMEOUT_MS = 60_000;

export function SessionTranscriptPane({ bottomInsetPx }: SessionTranscriptPaneProps) {
  useDebugRenderCount("session-transcript-pane");
  const selectedWorkspaceId = useHarnessStore((state) => state.selectedWorkspaceId);
  const handoff = usePlanHandoffDialogState();
  const { activateChatTab } = useWorkspaceShellActivation();
  const { openWorkspaceSession } = useWorkspaceActivationWorkflow();
  const { rehydrateSessionSlotFromHistory } = useSessionRuntimeActions();
  const { data: workspaceCollections } = useWorkspaces();
  const [olderHistoryLoadingSessionId, setOlderHistoryLoadingSessionId] = useState<string | null>(null);
  const immediatePaneState = useActiveTranscriptPaneState();
  const deferredPaneState = useDeferredValue(immediatePaneState);
  const transcriptDeferred =
    deferredPaneState.activeSessionId !== immediatePaneState.activeSessionId;
  const activeSessionId = transcriptDeferred
    ? null
    : deferredPaneState.activeSessionId;
  const optimisticPrompt = transcriptDeferred
    ? null
    : deferredPaneState.optimisticPrompt;
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
  useDebugValueChange("transcript_pane.inputs", "active_transcript_refs", {
    selectedWorkspaceId,
    immediateActiveSessionId: immediatePaneState.activeSessionId,
    deferredActiveSessionId: deferredPaneState.activeSessionId,
    transcriptDeferred,
    transcript,
    optimisticPrompt,
    sessionViewState,
    oldestLoadedEventSeq,
    workspaceCollections,
    selectedWorkspace,
    selectedCloudWorkspace,
    coworkManagedWorkspaces,
    linkedSessionWorkspaces,
  });
  const hasOlderHistory = oldestLoadedEventSeq !== null && oldestLoadedEventSeq > 1;
  const isLoadingOlderHistory = olderHistoryLoadingSessionId === activeSessionId;
  const loadOlderHistory = useCallback(() => {
    if (!activeSessionId || !selectedWorkspaceId || !hasOlderHistory || isLoadingOlderHistory) {
      return;
    }

    const selectionNonce = useHarnessStore.getState().workspaceSelectionNonce;
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
        const state = useHarnessStore.getState();
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
    const state = useHarnessStore.getState();
    return resolveTranscriptOpenSessionWorkspaceId({
      sessionId,
      role,
      sessionSlots: state.sessionSlots,
      fallbackWorkspaceId: activeSessionId
        ? state.sessionSlots[activeSessionId]?.workspaceId ?? selectedWorkspaceId
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

    const currentWorkspaceId = useHarnessStore.getState().selectedWorkspaceId;
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
    return (
      <DebugProfiler id="session-transcript-pane">
        <div className="h-full min-h-0" />
      </DebugProfiler>
    );
  }

  if (!activeSessionId || !transcript) {
    return null;
  }

  return (
    <DebugProfiler id="session-transcript-pane">
      <MessageList
        activeSessionId={activeSessionId}
        selectedWorkspaceId={selectedWorkspaceId}
        optimisticPrompt={optimisticPrompt}
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
