import { useCallback, useDeferredValue, useEffect, useState } from "react";
import { DebugProfiler } from "#product/components/diagnostics/DebugProfiler";
import { useActiveTranscriptPaneState } from "#product/hooks/chat/derived/use-active-session-transcript-state";
import { useDebugRenderCount } from "#product/hooks/ui/debug/use-debug-render-count";
import { MessageList } from "#product/components/workspace/chat/transcript/MessageList";
import { BackgroundWorkTranscriptRow } from "#product/components/workspace/activity/BackgroundWorkTranscriptRow";
import { ConnectedPlanHandoffDialog } from "#product/components/workspace/chat/plans/ConnectedPlanHandoffDialog";
import { usePlanHandoffDialogState } from "#product/hooks/plans/ui/use-plan-handoff-dialog-state";
import { useBackgroundWorkRowCounts } from "#product/hooks/activity/derived/use-background-work-row";
import { useBackgroundWorkFinishSignalTracking } from "#product/hooks/activity/lifecycle/use-background-work-finish-signal-tracking";
import { useOpenBackgroundWorkPane } from "#product/hooks/activity/workflows/use-open-background-work-pane";
import { useResizeObserverHeight } from "#product/hooks/ui/layout/use-resize-observer-height";
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
  const openBackgroundWorkPane = useOpenBackgroundWorkPane();
  // Review fix (bgwork R2 round 2): the row is a real content element sitting
  // ABOVE MessageList's own reserved end-padding, not decoration inside it —
  // so its own height must ALSO be reserved, or it paints over the last
  // turn's tail (see the comment at the row's render site below for the
  // full geometry). Measure it live rather than hardcoding a row height:
  // the row's rendered height moves with the appearance-scaling multiplier.
  const { ref: backgroundWorkRowRef, height: backgroundWorkRowHeightPx } =
    useResizeObserverHeight<HTMLDivElement>();
  // Review fix (bgwork R2 round 3): round 2 fixed the AT-BOTTOM overlap but
  // left the row floating over arbitrary mid-transcript content once the
  // user scrolled away — it is `position: absolute` in a static wrapper, so
  // it never tracked scroll. The handoff's own semantics settle this: the row
  // is a line at the END of the transcript, so scrolling away from the end
  // should hide it, exactly like the floating "scroll to bottom" button it
  // sits beside. Reuse that SAME signal (`useTranscriptStickToBottom`'s
  // `isPinnedToBottom`, already threaded out through
  // MessageList/ChatTranscriptView/the row lists as
  // `onIsPinnedToBottomChange` — no parallel scroll listener) rather than
  // inventing a second one. Starts `true`: the engine itself defaults pinned
  // and re-pins on session entry, so a fresh mount is at the bottom until
  // proven otherwise.
  const [isPinnedToBottom, setIsPinnedToBottom] = useState(true);
  const isBackgroundWorkRowVisible = hasBackgroundWork && isPinnedToBottom;
  // The reserve keys on `hasBackgroundWork`, not on the row's visibility:
  // shrinking `paddingEnd` on unpin isn't covered by
  // `use-transcript-stick-to-bottom`'s non-user-scroll guard (keyed only on
  // `autoFollowBottomInsetPx`), so the clamp-driven scroll event would strand
  // the viewport at bottom-but-unpinned with auto-follow off. The band is
  // below the fold while unpinned, so the constant reserve has no visible
  // cost. Accepted residual: if `hasBackgroundWork` itself flips false while
  // the user is parked unpinned within this reserved band, the same
  // uncovered structural shrink can still occur — a pre-existing guard gap
  // shared with any composer-driven inset change, out of this rung's scope.
  const messageListBottomInsetPx = hasBackgroundWork
    ? bottomInsetPx + backgroundWorkRowHeightPx
    : bottomInsetPx;
  const { rehydrateSessionSlotFromHistory } = useSessionHistoryHydration();
  const [olderHistoryLoadingSessionId, setOlderHistoryLoadingSessionId] = useState<string | null>(null);
  const immediatePaneState = useActiveTranscriptPaneState();
  const workspaceReceiptKey = useWorkspaceCreationReceiptKey();
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
  // Insurance for the session-switch window: `SessionTranscriptPane` itself
  // is not remounted per session (no `key`), so a stale `isPinnedToBottom`
  // from the PREVIOUS session's scrolled-up state could otherwise hide the
  // row for one frame in a brand-new, pinned-by-default session before the
  // row list's own reset-for-session effect reports back. `MessageList`'s
  // own reset already re-pins internally; this just keeps this pane's
  // gating state from lagging it.
  useEffect(() => {
    setIsPinnedToBottom(true);
  }, [activeSessionId]);
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
      {/* `relative` anchor for the background-work row below: R1 fed
          MessageList a clamped `bottomInsetPx={0}` while this row was
          visible so an external flex-sibling-plus-spacer partition could
          place the row without double-reserving the composer's clearance —
          that clamp severed the live composer-dock height from MessageList's
          own re-pin effect (`VirtualizedTranscriptRowList`'s
          `useLayoutEffect` re-pins on `totalContentHeight`, which is derived
          from the SAME `bottomInsetPx` via the virtualizer's `paddingEnd`),
          so a dock card growing while idle+pinned could clip the last turn
          until the next unrelated resize (carried R1 item 1).
          Fix round 1: stop clamping — MessageList gets the real, live
          `bottomInsetPx`/`nonDisplacingBottomInsetPx` exactly as it does on
          every other session, restoring that reactivity for free (no
          separate "force a re-pin" hook needed: the existing effect already
          keys off this same prop's downstream value). Review round 2 caught
          that round 1's row placement painted OVER the last turn's tail
          instead of clearing it: `bottomInsetPx` splits into a `structural`
          share (real, reserved-as-blank scroll space — the virtualizer's
          `paddingEnd`) and a `nonDisplacing` share (the composer's own
          translucent overlap zone, which is DELIBERATELY allowed to sit over
          the last turn's tail — see `useChatDockInset`'s
          `composerSurfaceOffsetTopPx`). Anchoring the row at the full
          `bottomInsetPx` placed its entire box inside the content-occupied
          range (everything above `structural`), regardless of
          `nonDisplacing` — the row is real, distinct content, not a scrim,
          so it may not share that overlap allowance.
          Fix round 2: feed MessageList `bottomInsetPx` PLUS the row's own
          live-measured height while it is visible — reserving one extra
          band the exact size of the row, immediately above where content
          used to stop. Round 2 anchored the row at `bottom:
          structuralBottomInsetPx` (`bottomInsetPx - nonDisplacing`),
          reasoning the row must not share the composer's overlap allowance.
          That reasoning about the ALLOWANCE was right but the ARITHMETIC was
          wrong: `VirtualTranscriptViewport` renders the nonDisplacing scrim
          as a sibling overlay (`top-full`, i.e. positioned at the content
          div's OWN bottom edge) that EXTENDS the scrollable region by exactly
          `nonDisplacing` past the shrunk `structural` paddingEnd — so the
          last real row's distance from the viewport's bottom edge, once
          pinned, is `structural + nonDisplacing`, i.e. the CONSTANT
          `bottomInsetPx` regardless of the split (confirmed via fresh
          Playwright measurement: anchoring at `structuralBottomInsetPx`
          reopened a gap of exactly `nonDisplacingBottomInsetPx`, e.g. 24px
          with a 24px composer scrim, while the round-2 fixture's own "dock
          card" scenario never actually varied `nonDisplacingBottomInsetPx`
          off zero, so it never exercised the split and never caught this).
          Fix round 3 (renumbered; corrects round 2's anchor arithmetic
          above): anchor at the plain `bottom: bottomInsetPx` — the row's box
          then exactly fills the newly-reserved band regardless of how much
          of `bottomInsetPx` is `nonDisplacing`: its bottom edge sits
          precisely where content used to end (a fixed `bottomInsetPx` above
          the viewport's bottom, composer scrim or not) and its top edge is
          exactly where content now ends post-augmentation.
          The row is `position: absolute` in this static-height wrapper, so
          scrolled away from bottom it would float over arbitrary
          mid-transcript content — hence gated on `isBackgroundWorkRowVisible`
          (`hasBackgroundWork && isPinnedToBottom`), with `isPinnedToBottom`
          reported upward via `onIsPinnedToBottomChange`, the SAME state the
          stick-to-bottom engine already computes for the in-list
          scroll-to-bottom button (no second scroll listener). See
          `messageListBottomInsetPx` above for why the reserve itself does
          NOT share this gate.
          This still does not achieve the handoff's literal "last row of the
          transcript column" in-scroll placement (an actual virtualized row)
          — that remains out of this rung's scope; see the PR body. */}
      <div className="relative flex min-h-0 flex-1 flex-col">
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
          onIsPinnedToBottomChange={setIsPinnedToBottom}
          onHandOffPlanToNewSession={handoff.open}
          onOpenSession={openTranscriptSession}
          canOpenSession={canOpenTranscriptSession}
        />
        {isBackgroundWorkRowVisible && (
          <div
            ref={backgroundWorkRowRef}
            data-testid="background-work-row-anchor"
            className={`absolute inset-x-0 ${CHAT_SURFACE_GUTTER_CLASSNAME}`}
            style={{ bottom: bottomInsetPx }}
          >
            <div
              className={`${CHAT_COLUMN_CLASSNAME} pt-transcript-turn-tight pb-2`}
            >
              <BackgroundWorkTranscriptRow
                runningCount={backgroundWorkRowCounts.runningCount}
                finishedCount={backgroundWorkRowCounts.finishedCount}
                onOpen={openBackgroundWorkPane}
              />
            </div>
          </div>
        )}
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
