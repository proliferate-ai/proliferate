import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  TranscriptState,
  TurnRecord,
} from "@proliferate/product-domain/chats/transcript/chat-transcript-state";
import type { SessionViewState } from "@proliferate/product-domain/sessions/activity";
import {
  findTrailingLiveExplorationBlock,
  findTrailingLiveWorkBlock,
  resolveTurnPromptTiming,
} from "@proliferate/product-domain/chats/transcript/transcript-rendering";
import {
  latestTransientStatusText,
  shouldAllowTurnTrailingStatus,
} from "@proliferate/product-domain/chats/transcript/transcript-trailing-status";
import type { TranscriptVirtualRow } from "@proliferate/product-domain/chats/transcript/transcript-virtual-rows";
import type { TurnDisplayBlock } from "@proliferate/product-domain/chats/transcript/transcript-presentation";
import type { ChatTranscriptTurnStatusInput } from "./ChatTranscriptViewTypes";
import {
  findLatestTurnPresentation,
  turnHasActiveToolWork,
} from "./ChatTranscriptViewRules";

const LIVE_STATUS_GRACE_MS = 150;
// Quiet period before "Thinking…" RETURNS after yielding to tool/command work
// — long enough that back-to-back commands never get a status flash between
// them.
const LIVE_STATUS_REAPPEAR_GRACE_MS = 500;

export interface LatestTranscriptLiveStatus {
  latestLiveExplorationBlock: Extract<TurnDisplayBlock, { kind: "collapsed_actions" }> | null;
  latestLiveStatus: ReactNode;
}

export function useLatestTranscriptLiveStatus({
  latestTurnId,
  latestTurn,
  transcript,
  virtualRows,
  outboxStartedAtByPromptId,
  sessionViewState,
  renderTurnTrailingStatus,
}: {
  latestTurnId: string | null;
  latestTurn: TurnRecord | null;
  transcript: TranscriptState;
  virtualRows: readonly TranscriptVirtualRow[];
  outboxStartedAtByPromptId: ReadonlyMap<string, string>;
  sessionViewState: SessionViewState;
  renderTurnTrailingStatus?: (input: ChatTranscriptTurnStatusInput) => ReactNode;
}): LatestTranscriptLiveStatus {
  const latestTurnInProgress = !!latestTurn && !latestTurn.completedAt;
  const latestTurnPresentation = useMemo(
    () => findLatestTurnPresentation(virtualRows, latestTurnId),
    [latestTurnId, virtualRows],
  );
  const latestLiveExplorationBlock = useMemo(
    () => latestTurnPresentation
      ? findTrailingLiveExplorationBlock(
          latestTurnPresentation.displayBlocks,
          transcript,
          latestTurnInProgress,
        )
      : null,
    [latestTurnInProgress, latestTurnPresentation, transcript],
  );
  const latestLiveWorkBlock = useMemo(
    () => latestTurnPresentation
      ? findTrailingLiveWorkBlock(
          latestTurnPresentation.displayBlocks,
          transcript,
          latestTurnInProgress,
        )
      : null,
    [latestTurnInProgress, latestTurnPresentation, transcript],
  );
  const latestTurnHasActiveToolWork = latestTurn
    ? turnHasActiveToolWork(latestTurn, transcript)
    : false;
  const latestTransientText = latestTurn
    ? latestTransientStatusText(latestTurn, transcript)
    : null;
  const latestTurnTiming = latestTurn
    ? resolveTurnPromptTiming(latestTurn, transcript, outboxStartedAtByPromptId)
    : null;
  const shouldShowDelayedLatestLiveStatus = !!latestTurn
    && latestTurnInProgress
    && !latestLiveExplorationBlock
    && !latestLiveWorkBlock
    && !latestTurnHasActiveToolWork
    && sessionViewState === "working"
    && shouldAllowTurnTrailingStatus({
      turn: latestTurn,
      transcript,
      isLatestTurnInProgress: true,
    });
  const shouldShowImmediateOutboxLiveStatus =
    shouldShowDelayedLatestLiveStatus
    && latestTurnTiming?.isOutboxStartedAt === true;
  const [showDelayedLatestLiveStatus, setShowDelayedLatestLiveStatus] = useState(false);
  const shownForTurnIdRef = useRef<string | null>(null);

  // The grace ref resets ONLY when the turn changes — NOT when the status
  // temporarily yields (e.g. to a live exploration/work block). Resetting on
  // every hide re-applied the LIVE_STATUS_GRACE_MS delay at each
  // status⇄block transition, blinking the "Thinking…" row mid-turn.
  useEffect(() => {
    if (shownForTurnIdRef.current !== null && shownForTurnIdRef.current !== latestTurnId) {
      shownForTurnIdRef.current = null;
    }
  }, [latestTurnId]);

  // Visibility rules (asymmetric on purpose):
  // - HIDE instantly when tool/command work starts (shouldShow -> false).
  // - While eligible AND visible: STAY visible — no re-arming on stream-item
  //   churn (that strobed the row).
  // - FIRST appearance in a turn: short grace (snappy).
  // - RE-appearance after yielding (e.g. between consecutive commands): a
  //   longer quiet period, so "Thinking…" never flashes in the gaps of a
  //   command sequence — it only returns once the agent has actually been
  //   quiet for a while.
  // Deps deliberately exclude item/text churn: the timers must run to
  // completion while items stream.
  useEffect(() => {
    if (!shouldShowDelayedLatestLiveStatus) {
      setShowDelayedLatestLiveStatus(false);
      return;
    }
    if (showDelayedLatestLiveStatus) {
      return;
    }

    const graceMs = shownForTurnIdRef.current === latestTurnId
      ? LIVE_STATUS_REAPPEAR_GRACE_MS
      : LIVE_STATUS_GRACE_MS;
    const timeout = window.setTimeout(() => {
      shownForTurnIdRef.current = latestTurnId;
      setShowDelayedLatestLiveStatus(true);
    }, graceMs);
    return () => window.clearTimeout(timeout);
  }, [
    latestTurnId,
    shouldShowDelayedLatestLiveStatus,
    showDelayedLatestLiveStatus,
  ]);

  // SINGLE-SHIMMER RULE: a live exploration/work block (or any active tool)
  // renders its own CollapsedActions shimmer. The delayed-visibility state
  // above lags one render behind the synchronous eligibility, so a freshly
  // started tool could otherwise leave the tail shimmer mounted for a frame
  // alongside the summary shimmer — two sweeps in one viewport. Re-checking the
  // synchronous conditions here hides the tail in the same render, so there is
  // never more than one shimmer.
  const hasCompetingLiveShimmer =
    !!latestLiveExplorationBlock
    || !!latestLiveWorkBlock
    || latestTurnHasActiveToolWork;
  // NEEDS-INPUT MARKER: a pending interaction is a stable blocking state, not
  // a transient stream gap, so it bypasses both the "working"-only shimmer
  // eligibility (and its grace timers — show immediately, no strobe risk) AND
  // the competing-shimmer suppression: the request that pauses a tool call
  // leaves that call counted as active work, which would otherwise hide the
  // marker for exactly the case it exists for. The marker is static (not a
  // shimmer), so the single-shimmer rule is preserved. The owner's prose-tail
  // rule still applies via shouldAllowTurnTrailingStatus.
  const latestNeedsInputStatus =
    !!latestTurn
    && latestTurnInProgress
    && sessionViewState === "needs_input"
    && shouldAllowTurnTrailingStatus({
        turn: latestTurn,
        transcript,
        isLatestTurnInProgress: true,
      })
      ? renderTurnTrailingStatus?.({
          startedAt: latestTurnTiming?.startedAt ?? latestTurn.startedAt,
          sessionViewState,
          transientStatusText: latestTransientText,
        }) ?? null
      : null;
  const latestLiveStatus = latestNeedsInputStatus
    ?? (latestTurn
      && !hasCompetingLiveShimmer
      && (showDelayedLatestLiveStatus || shouldShowImmediateOutboxLiveStatus)
        ? renderTurnTrailingStatus?.({
            startedAt: latestTurnTiming?.startedAt ?? latestTurn.startedAt,
            sessionViewState,
            transientStatusText: latestTransientText,
          }) ?? null
        : null);

  return {
    latestLiveExplorationBlock,
    latestLiveStatus,
  };
}
