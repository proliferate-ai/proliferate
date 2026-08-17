import { useCallback, useDeferredValue, useEffect, useState } from "react";
import { DebugProfiler } from "#product/components/diagnostics/DebugProfiler";
import { useActiveTranscriptPaneState } from "#product/hooks/chat/derived/use-active-session-transcript-state";
import { useDebugRenderCount } from "#product/hooks/ui/debug/use-debug-render-count";
import { MessageList } from "#product/components/workspace/chat/transcript/MessageList";
import { BackgroundWorkTranscriptRow } from "#product/components/workspace/activity/BackgroundWorkTranscriptRow";
import { ConnectedPlanHandoffDialog } from "#product/components/workspace/chat/plans/ConnectedPlanHandoffDialog";
import { usePlanHandoffDialogState } from "#product/hooks/plans/ui/use-plan-handoff-dialog-state";
import { useBackgroundWorkRowCounts } from "#product/hooks/activity/derived/use-background-work-row";
import { useSessionHistoryHydration } from "#product/hooks/sessions/lifecycle/use-session-history-hydration";
import { useTranscriptSessionNavigationActions } from "#product/hooks/chat/workflows/use-transcript-session-navigation-actions";
import { useWorkspaceCreationReceiptKey } from "#product/hooks/workspaces/derived/use-workspace-creation-receipt";
import { TranscriptSwitchingPlaceholder } from "#product/components/workspace/chat/surface/TranscriptSwitchingPlaceholder";
import type { GoalTranscriptEvent } from "#product/domain/activity/goal-transcript-events";
import {
  CHAT_COLUMN_CLASSNAME,
  CHAT_SURFACE_GUTTER_CLASSNAME,
} from "#product/config/chat-layout";
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
  const hasBackgroundWork = backgroundWorkRowCounts.runningCount > 0
    || backgroundWorkRowCounts.finishedCount > 0;
  // The composer dock is an ABSOLUTELY positioned overlay anchored to the
  // outer `ChatView` root (`shellClassName="... absolute inset-x-0 bottom-0"`
  // in ChatView.tsx), not a normal-flow sibling — so the flex column
  // MessageList and this row live in always spans the pane's FULL height,
  // right underneath that overlay. `bottomInsetPx` (`stickyBottomInsetPx`
  // from `useChatDockInset`) is sized to the composer's real rendered
  // height; MessageList spends it as INTERNAL scroll padding so the last
  // turn clears the composer once scrolled to bottom. A plain sibling row
  // placed after MessageList does not benefit from that internal padding —
  // it renders at the very bottom of the (full-height) flex column, which
  // is exactly the composer's overlap zone, so it would paint invisibly
  // behind the composer's backdrop.
  //
  // Fix: reserve the composer's full `bottomInsetPx` as an explicit,
  // external flex sibling AFTER the row (not inside MessageList), and stop
  // asking MessageList to reserve any of it internally (`bottomInsetPx={0}`
  // below). The three flex children — MessageList, the row, the spacer —
  // now partition the full pane height so MessageList's own box already
  // ends exactly where the row should start, and the row's own box already
  // ends exactly where the composer starts. Nothing is reserved twice: the
  // spacer's height is the SAME `bottomInsetPx` MessageList used to consume
  // internally, just relocated outside it, so the total clearance between
  // the last turn and the composer is unchanged from before this row
  // existed — the row just fills space that used to render blank.
  //
  // Known R1 trade-off: `nonDisplacingBottomInsetPx` (the composer-dock-card
  // slack MessageList would otherwise keep) clamps to 0 while the row is
  // visible, since `resolveTranscriptBottomInsets` clamps it to
  // `bottomInsetPx`. A session showing BOTH a dock card (e.g. the workspace
  // recovery panel) AND background work at once briefly loses that slack —
  // narrow, disclosed, and out of R1's scope to chase further.
  const messageListBottomInsetPx = hasBackgroundWork ? 0 : bottomInsetPx;
  const { rehydrateSessionSlotFromHistory } = useSessionHistoryHydration();
  const [olderHistoryLoadingSessionId, setOlderHistoryLoadingSessionId] = useState<string | null>(null);
  const immediatePaneState = useActiveTranscriptPaneState();
  const workspaceReceiptKey = useWorkspaceCreationReceiptKey();
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
      <MessageList
        activeSessionId={activeSessionId}
        selectedWorkspaceId={selectedWorkspaceId}
        workspaceReceiptKey={workspaceReceiptKey}
        optimisticPrompt={optimisticPrompt}
        outboxEntries={outboxEntries}
        transcript={transcript}
        goalEvents={goalEvents}
        sessionViewState={sessionViewState}
        hasOlderHistory={hasOlderHistory}
        isLoadingOlderHistory={isLoadingOlderHistory}
        olderHistoryCursor={oldestLoadedEventSeq}
        bottomInsetPx={messageListBottomInsetPx}
        nonDisplacingBottomInsetPx={nonDisplacingBottomInsetPx}
        onLoadOlderHistory={loadOlderHistory}
        onHandOffPlanToNewSession={handoff.open}
        onOpenSession={openTranscriptSession}
        canOpenSession={canOpenTranscriptSession}
      />
      {hasBackgroundWork && (
        <>
          {/* Last row of the transcript column, in the turn stack's own
              tight intra-turn rhythm (HANDOFF-background-work.md placement
              note). A flex sibling of MessageList's own `flex-1 min-h-0`
              scroll region, not a row threaded through the virtualized row
              list — see the `messageListBottomInsetPx` comment above for
              why. `shrink-0` keeps it at its natural (single-line) height
              regardless of how much MessageList shrinks to make room. */}
          <div
            className={`shrink-0 ${CHAT_SURFACE_GUTTER_CLASSNAME} ${CHAT_COLUMN_CLASSNAME} pt-transcript-turn-tight pb-2`}
          >
            <BackgroundWorkTranscriptRow
              runningCount={backgroundWorkRowCounts.runningCount}
              finishedCount={backgroundWorkRowCounts.finishedCount}
              // SEAM (delivery spec rung R2): the Background work pane
              // doesn't exist yet, so there is nowhere for this to open to.
              // R2 mounts `BackgroundWorkPane` in `RightPanelContent` and
              // replaces this no-op with the real open action.
              onOpen={() => {}}
            />
          </div>
          {/* The composer's full reserve, relocated here from MessageList's
              own internal padding (see the comment above) so the row above
              renders in the composer's true visual clearance rather than
              behind its absolutely positioned backdrop. */}
          <div aria-hidden="true" className="shrink-0" style={{ height: bottomInsetPx }} />
        </>
      )}
      {handoff.plan && (
        <ConnectedPlanHandoffDialog
          plan={handoff.plan}
          onClose={handoff.close}
        />
      )}
    </DebugProfiler>
  );
}
