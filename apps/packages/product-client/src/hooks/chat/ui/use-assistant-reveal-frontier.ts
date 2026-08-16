import { useCallback, useRef, useState } from "react";
import type { AssistantMessageRevealState } from "#product/lib/domain/chat/transcript/assistant-message-reveal";
import {
  getAssistantRevealProgress,
  recordAssistantRevealProgress,
} from "#product/hooks/chat/ui/assistant-reveal-progress";
import { logDevAssistantRevealState } from "#product/hooks/chat/ui/dev-assistant-reveal-log";

type AssistantRevealClaim = {
  itemId: string;
  targetLength: number;
};

export const RECENT_ASSISTANT_REVEAL_WINDOW_MS = 60_000;

export function useAssistantRevealFrontier({
  itemId,
  isLatestTurn,
  targetLength,
  turnCompletedAt,
  turnId,
}: {
  itemId: string | null;
  isLatestTurn: boolean;
  targetLength: number;
  turnCompletedAt: string | null | undefined;
  turnId: string;
}) {
  const revealOriginRef = useRef({
    turnId,
    wasLive: !turnCompletedAt,
  });
  if (revealOriginRef.current.turnId !== turnId) {
    revealOriginRef.current = { turnId, wasLive: !turnCompletedAt };
  } else if (!turnCompletedAt) {
    revealOriginRef.current.wasLive = true;
  }

  // Streaming continuity (Chat Scroll ADR Q15): text that already exists when
  // this row first renders is finalized history for this viewer — only deltas
  // that arrive while the row is mounted may animate. Raising the shared
  // reveal floor before child rows mount keeps a stream that kept ingesting
  // while its workspace was backgrounded from re-playing on return. Items that
  // appear on later renders start at floor zero, so a fresh live chunk still
  // paces in through the frontier.
  const appliedMountRevealFloorRef = useRef(false);
  if (!appliedMountRevealFloorRef.current) {
    appliedMountRevealFloorRef.current = true;
    if (itemId !== null && targetLength > 0) {
      const cachedAtMount = getAssistantRevealProgress(itemId);
      if (
        !cachedAtMount
        || cachedAtMount.visibleLength < targetLength
        || !cachedAtMount.complete
      ) {
        recordAssistantRevealProgress(itemId, {
          complete: true,
          phase: "idle",
          visibleLength: Math.max(targetLength, cachedAtMount?.visibleLength ?? 0),
          targetLength,
          isStreaming: false,
        });
      }
    }
  }

  const [assistantRevealClaim, setAssistantRevealClaim] =
    useState<AssistantRevealClaim | null>(null);
  const cachedAssistantReveal = getAssistantRevealProgress(itemId);
  const claimedVisibleLength = assistantRevealClaim?.itemId === itemId
    ? assistantRevealClaim.targetLength
    : cachedAssistantReveal?.visibleLength ?? 0;
  const shouldAnimate = shouldHoldAssistantRevealFrontier({
    itemId,
    hasUnrevealedText: targetLength > claimedVisibleLength,
    cachedRevealComplete: cachedAssistantReveal?.complete ?? null,
    eligibleOrigin: revealOriginRef.current.wasLive
      || cachedAssistantReveal !== null
      || (isLatestTurn && isRecentAssistantCompletion(turnCompletedAt)),
  });

  const handleAssistantRevealStateChange = useCallback((
    changedItemId: string,
    state: AssistantMessageRevealState,
  ) => {
    logDevAssistantRevealState({ turnId, itemId: changedItemId, state });
    if (!state.complete) return;

    setAssistantRevealClaim((current) => {
      if (
        current?.itemId === changedItemId
        && current.targetLength >= state.targetLength
      ) {
        return current;
      }
      return { itemId: changedItemId, targetLength: state.targetLength };
    });
  }, [turnId]);

  return {
    animateAssistantRevealItemId: shouldAnimate ? itemId : null,
    assistantRevealComplete: !shouldAnimate,
    handleAssistantRevealStateChange,
  };
}

export function isRecentAssistantCompletion(
  completedAt: string | null | undefined,
  nowMs = Date.now(),
): boolean {
  if (!completedAt) return false;

  const completedAtMs = Date.parse(completedAt);
  const ageMs = nowMs - completedAtMs;
  return Number.isFinite(completedAtMs)
    && ageMs >= 0
    && ageMs <= RECENT_ASSISTANT_REVEAL_WINDOW_MS;
}

export function shouldHoldAssistantRevealFrontier({
  itemId,
  hasUnrevealedText,
  cachedRevealComplete,
  eligibleOrigin,
}: {
  itemId: string | null;
  hasUnrevealedText: boolean;
  cachedRevealComplete: boolean | null;
  eligibleOrigin: boolean;
}): boolean {
  return itemId !== null
    && eligibleOrigin
    && (hasUnrevealedText || cachedRevealComplete === false);
}
