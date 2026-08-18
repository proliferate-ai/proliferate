import { useCallback, useDeferredValue, useEffect, useState } from "react";
import { DebugProfiler } from "#product/components/diagnostics/DebugProfiler";
import { useActiveTranscriptPaneState } from "#product/hooks/chat/derived/use-active-session-transcript-state";
import { useDebugRenderCount } from "#product/hooks/ui/debug/use-debug-render-count";
import { MessageList } from "#product/components/workspace/chat/transcript/MessageList";
import { ConnectedPlanHandoffDialog } from "#product/components/workspace/chat/plans/ConnectedPlanHandoffDialog";
import { usePlanHandoffDialogState } from "#product/hooks/plans/ui/use-plan-handoff-dialog-state";
import { useBackgroundWorkRowCounts } from "#product/hooks/activity/derived/use-background-work-row";
import { useBackgroundCompletionReceipts } from "#product/hooks/activity/derived/use-background-completion-receipts";
import { useBackgroundWorkFinishSignalTracking } from "#product/hooks/activity/lifecycle/use-background-work-finish-signal-tracking";
import { useSessionHistoryHydration } from "#product/hooks/sessions/lifecycle/use-session-history-hydration";
import { useTranscriptSessionNavigationActions } from "#product/hooks/chat/workflows/use-transcript-session-navigation-actions";
import { useWorkspaceCreationReceiptKey } from "#product/hooks/workspaces/derived/use-workspace-creation-receipt";
import { TranscriptSwitchingPlaceholder } from "#product/components/workspace/chat/surface/TranscriptSwitchingPlaceholder";
import type { GoalTranscriptEvent } from "#product/domain/activity/goal-transcript-events";
import { logLatency } from "#product/lib/infra/measurement/measurement-port";
import { finishDeferredWorkspaceOpenForSession } from "#product/lib/infra/diagnostics/renderer-flow-timing";
import {
  ensureSessionTranscriptEntry,
  patchSessionRecord,
} from "#product/stores/sessions/session-records";
import { useSessionDirectoryStore } from "#product/stores/sessions/session-directory-store";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";

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
  const backgroundWorkRowCounts = useBackgroundWorkRowCounts();
  const { rehydrateSessionSlotFromHistory } = useSessionHistoryHydration();
  const [olderHistoryLoadingSessionId, setOlderHistoryLoadingSessionId] = useState<string | null>(null);
  const immediatePaneState = useActiveTranscriptPaneState();
  const workspaceReceiptKey = useWorkspaceCreationReceiptKey();
  // Inline completion receipts (bgwork r6, in-flow placement r6 round 2):
  // synthesized from the active session's activity fold — a terminal that exits
  // or a native subagent that finishes yields a right-aligned receipt that
  // MessageList interleaves into the transcript row sequence (as a real
  // in-scroll row), anchored to the turn that was latest when it was observed
  // so it reads in stream order before the wake turn. Keyed on the IMMEDIATE
  // session id, same as the finish-signal tracking below, so a completion is
  // never missed while the heavier transcript render catches up to a session
  // switch; the anchor turn is likewise read off the immediate transcript.
  const immediateLatestTurnId = immediatePaneState.transcript
    ? immediatePaneState.transcript.turnOrder[
      immediatePaneState.transcript.turnOrder.length - 1
    ] ?? null
    : null;
  const completionReceipts = useBackgroundCompletionReceipts(
    immediatePaneState.activeSessionId,
    immediateLatestTurnId,
  );
  // Finish-signal ladder (rung R5): the only place that observes a native
  // subagent disappearing from the roster, which is the only way to ever
  // learn it finished (session-activity-architecture — subagents leave the
  // roster the instant they finish; processes never leave it, so they need
  // no equivalent tracking here). Keyed on the IMMEDIATE session id, not the
  // deferred one below — a finish must never be missed just because the
  // heavier transcript render is still catching up to a session switch.
  useBackgroundWorkFinishSignalTracking(immediatePaneState.activeSessionId);
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
  const { canOpenTranscriptSession, openTranscriptSession } =
    useTranscriptSessionNavigationActions({
      sourceSessionId: activeSessionId,
      fallbackWorkspaceId: selectedWorkspaceId,
      transcript,
    });
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
    }).then((hydrated) => {
      if (!hydrated) {
        return;
      }
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

  // UX-latency R14: honest workspace_open content_stable. The bootstrap no
  // longer finishes that flow at its own completion — transcript hydration is
  // off its critical path. It DEFERS the mark to here: once the selected
  // session's transcript is actually HYDRATED, we finish the flow. This is the
  // first moment the user can truly see the real transcript. finishDeferred…
  // no-ops when there is no deferred workspace_open flow for this session (a
  // plain in-workspace switch), so it is safe to run on every hydration.
  //
  // The gate is the directory entry's `transcriptHydrated` flag, NOT object
  // presence of `transcript`. On cold open selectSession synchronously seeds
  // createEmptySessionRecord with an empty-but-truthy TranscriptState scaffold;
  // gating on `transcript` would fire content_stable ~0ms against that scaffold
  // (lying: data_to_stable_ms would read ~0 for the exact case that used to
  // measure 1.2–1.8s) and the real content would pop in AFTER we reported
  // stable. Both hydration call sites (this pane's self-hydration and the
  // bootstrap kickoff) patch transcriptHydrated=true only once history has been
  // fetched and applied, so a hydrated-empty session (new workspace, zero
  // messages) still counts as stable while the scaffold-empty state does not.
  const transcriptHydrated = useSessionDirectoryStore((state) =>
    activeSessionId
      ? state.entriesById[activeSessionId]?.transcriptHydrated ?? false
      : false
  );
  useEffect(() => {
    if (transcriptDeferred || !activeSessionId || !transcriptHydrated) {
      return;
    }
    finishDeferredWorkspaceOpenForSession(activeSessionId, {
      content_stable_source: "transcript_committed",
    });
  }, [activeSessionId, transcriptHydrated, transcriptDeferred]);

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
      {/* Background-work completion receipts and the running-count footer are
          real in-scroll transcript rows (bgwork r6 round 2, superseding R1's
          dock-anchored floating band): MessageList interleaves each receipt
          after its anchor turn and appends the footer at the tail, so both
          scroll with content and need no external reserve, anchor arithmetic,
          or pinned-to-bottom visibility gating. */}
      <div className="flex min-h-0 flex-1 flex-col">
        <MessageList
          activeSessionId={activeSessionId}
          selectedWorkspaceId={selectedWorkspaceId}
          workspaceReceiptKey={workspaceReceiptKey}
          optimisticPrompt={optimisticPrompt}
          outboxEntries={outboxEntries}
          transcript={transcript}
          goalEvents={goalEvents}
          completionReceipts={completionReceipts}
          backgroundWorkRunningCount={backgroundWorkRowCounts.runningCount}
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
      </div>
      {handoff.plan && (
        <ConnectedPlanHandoffDialog
          plan={handoff.plan}
          onClose={handoff.close}
        />
      )}
    </DebugProfiler>
  );
}
