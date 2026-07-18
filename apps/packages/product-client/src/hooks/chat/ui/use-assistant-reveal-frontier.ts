import { useCallback, useRef, useState } from "react";
import type { AssistantMessageRevealState } from "#product/components/workspace/chat/transcript/AssistantMessage";
import { getAssistantRevealProgress } from "#product/lib/infra/chat/assistant-reveal-progress";
import { logDevAssistantRevealState } from "#product/lib/infra/debug/dev-assistant-reveal-log";

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
