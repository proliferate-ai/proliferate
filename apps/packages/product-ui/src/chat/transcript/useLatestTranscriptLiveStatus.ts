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

  useEffect(() => {
    if (!shouldShowDelayedLatestLiveStatus) {
      shownForTurnIdRef.current = null;
      setShowDelayedLatestLiveStatus(false);
      return;
    }

    // FLICKER GUARD: once the status is visible for a turn, keep it visible —
    // re-arming the grace timer on every stream item (itemOrder.length is a
    // dep) used to hide the "Thinking…" row for LIVE_STATUS_GRACE_MS on each
    // new item, strobing it throughout active streams. The grace delay only
    // applies to the FIRST appearance per turn.
    if (shownForTurnIdRef.current === latestTurnId) {
      return;
    }

    setShowDelayedLatestLiveStatus(false);
    const timeout = window.setTimeout(() => {
      shownForTurnIdRef.current = latestTurnId;
      setShowDelayedLatestLiveStatus(true);
    }, LIVE_STATUS_GRACE_MS);
    return () => window.clearTimeout(timeout);
  }, [
    latestTransientText,
    latestTurn?.itemOrder.length,
    latestTurnTiming?.startedAt,
    latestTurnId,
    shouldShowDelayedLatestLiveStatus,
  ]);

  const latestLiveStatus = latestTurn
    && (showDelayedLatestLiveStatus || shouldShowImmediateOutboxLiveStatus)
      ? renderTurnTrailingStatus?.({
          startedAt: latestTurnTiming?.startedAt ?? latestTurn.startedAt,
          sessionViewState,
          transientStatusText: latestTransientText,
        }) ?? null
      : null;

  return {
    latestLiveExplorationBlock,
    latestLiveStatus,
  };
}
