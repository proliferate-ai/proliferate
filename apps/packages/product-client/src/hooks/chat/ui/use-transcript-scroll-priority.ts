import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { TRANSCRIPT_USER_SCROLL_SETTLE_MS } from "#product/hooks/chat/ui/transcript-row-list-model";

export { TRANSCRIPT_USER_SCROLL_SETTLE_MS } from "#product/hooks/chat/ui/transcript-row-list-model";

interface ScrollSample {
  programmatic: boolean;
  userInitiated?: true;
}

interface FrozenTranscriptState<T> {
  scopeKey: string;
  value: T;
}

export type TranscriptScrollPauseListener = () => void;

/**
 * Native scrolling owns the frame while the user is moving through history.
 * Hold the last committed transcript snapshot during that short interaction so
 * live stream renders cannot compete with scroll paints, then publish the
 * newest snapshot once input has settled. Programmatic follow/anchor scrolls
 * intentionally do not engage this gate.
 */
export function useTranscriptScrollPriority<T>({
  latestValue,
  scopeKey,
}: {
  latestValue: T;
  scopeKey: string;
}) {
  const committedStateRef = useRef<FrozenTranscriptState<T>>({
    scopeKey,
    value: latestValue,
  });
  const frozenRef = useRef<FrozenTranscriptState<T> | null>(null);
  const synchronousPauseListenersRef = useRef<Set<TranscriptScrollPauseListener>>(
    new Set(),
  );
  const settleTimerRef = useRef<number | null>(null);
  const [isUserScrolling, setIsUserScrolling] = useState(false);

  const clearSettleTimer = useCallback(() => {
    if (settleTimerRef.current !== null) {
      window.clearTimeout(settleTimerRef.current);
      settleTimerRef.current = null;
    }
  }, []);

  const releaseFrozenSnapshot = useCallback(() => {
    clearSettleTimer();
    frozenRef.current = null;
    setIsUserScrolling(false);
  }, [clearSettleTimer]);

  const registerSynchronousPause = useCallback((
    listener: TranscriptScrollPauseListener,
  ) => {
    const listeners = synchronousPauseListenersRef.current;
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  const prioritizeScrollSample = useCallback((sample?: ScrollSample) => {
    if (sample?.programmatic !== false) {
      return;
    }

    if (sample.userInitiated === true) {
      // Cancel frame schedulers in the input event's call stack. React state
      // still owns the sustained hold, but cannot pre-empt an already queued
      // animation frame before its next commit/effect cycle by itself.
      for (const listener of synchronousPauseListenersRef.current) {
        listener();
      }
    }

    const committedState = committedStateRef.current;
    const currentScopeKey = committedState.scopeKey;
    const frozen = frozenRef.current;
    if (sample.userInitiated !== true && frozen?.scopeKey !== currentScopeKey) {
      return;
    }
    if (frozen?.scopeKey !== currentScopeKey) {
      frozenRef.current = {
        scopeKey: currentScopeKey,
        value: committedState.value,
      };
      setIsUserScrolling(true);
    }

    clearSettleTimer();
    settleTimerRef.current = window.setTimeout(
      releaseFrozenSnapshot,
      TRANSCRIPT_USER_SCROLL_SETTLE_MS,
    );
  }, [clearSettleTimer, releaseFrozenSnapshot]);

  // Never let a snapshot from the previous workspace/session cross a scope
  // transition, even if the user switches sessions mid-momentum-scroll.
  useLayoutEffect(() => {
    committedStateRef.current = {
      scopeKey,
      value: latestValue,
    };
    if (frozenRef.current && frozenRef.current.scopeKey !== scopeKey) {
      releaseFrozenSnapshot();
    }
  }, [latestValue, releaseFrozenSnapshot, scopeKey]);

  useEffect(() => clearSettleTimer, [clearSettleTimer]);

  const frozen = frozenRef.current;
  const effectiveValue = isUserScrolling && frozen?.scopeKey === scopeKey
    ? frozen.value
    : latestValue;

  return {
    effectiveValue,
    isUserScrolling,
    prioritizeScrollSample,
    registerSynchronousPause,
  };
}
