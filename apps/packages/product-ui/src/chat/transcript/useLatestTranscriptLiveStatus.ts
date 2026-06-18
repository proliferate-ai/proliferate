import {
  useEffect,
  useMemo,
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

const LIVE_STATUS_GRACE_MS = 750;

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
  reasoningActive = false,
  renderTurnTrailingStatus,
}: {
  latestTurnId: string | null;
  latestTurn: TurnRecord | null;
  transcript: TranscriptState;
  virtualRows: readonly TranscriptVirtualRow[];
  outboxStartedAtByPromptId: ReadonlyMap<string, string>;
  sessionViewState: SessionViewState;
  reasoningActive?: boolean;
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
    && transcript.isStreaming
    && sessionViewState === "working"
    && shouldAllowTurnTrailingStatus({
      turn: latestTurn,
      transcript,
      isLatestTurnInProgress: true,
    });
  const shouldShowImmediateOutboxLiveStatus =
    shouldShowDelayedLatestLiveStatus
    && latestTurnTiming?.isOutboxStartedAt === true;
  // In reasoning mode the agent is always thinking for the duration of the
  // turn, but transient thoughts are filtered out and the coarse stream flag
  // can briefly drop (or prose lands) before the turn ends — which would hide
  // the trailing indicator. Force it on for the whole in-progress turn so the
  // thinking affordance never disappears mid-turn when reasoning is enabled.
  const shouldForceReasoningLiveStatus = reasoningActive
    && !!latestTurn
    && latestTurnInProgress
    && !latestLiveExplorationBlock
    && !latestLiveWorkBlock
    && !latestTurnHasActiveToolWork;
  const [showDelayedLatestLiveStatus, setShowDelayedLatestLiveStatus] = useState(false);

  useEffect(() => {
    if (!shouldShowDelayedLatestLiveStatus) {
      setShowDelayedLatestLiveStatus(false);
      return;
    }

    setShowDelayedLatestLiveStatus(false);
    const timeout = window.setTimeout(() => {
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

  const shouldShowLatestLiveStatus = showDelayedLatestLiveStatus
    || shouldShowImmediateOutboxLiveStatus
    || shouldForceReasoningLiveStatus;

  const latestLiveStatus = latestTurn && shouldShowLatestLiveStatus
    ? renderTurnTrailingStatus?.({
        startedAt: latestTurnTiming?.startedAt ?? latestTurn.startedAt,
        // Forcing reasoning keeps the thinking indicator alive even if the
        // coarse view state briefly leaves "working"; the renderer only paints
        // the indicator for the "working" state, so pin it here.
        sessionViewState: shouldForceReasoningLiveStatus ? "working" : sessionViewState,
        transientStatusText: latestTransientText,
      }) ?? null
    : null;

  return {
    latestLiveExplorationBlock,
    latestLiveStatus,
  };
}
