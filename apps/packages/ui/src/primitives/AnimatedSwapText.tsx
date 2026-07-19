import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

const SWAP_DURATION_MS = 240;

interface AnimatedSwapTextProps {
  /** Stable semantic key for the rendered value. */
  valueKey: string;
  value: ReactNode;
}

interface SwapTransition {
  id: number;
  outgoing: ReactNode;
}

/**
 * Keeps the incoming value owned by the current render, so optimistic control
 * updates are visible immediately. The previous committed value is retained
 * only for the compositor-only exit animation.
 */
export function AnimatedSwapText({ valueKey, value }: AnimatedSwapTextProps) {
  const committedValueRef = useRef({ key: valueKey, value });
  const nextTransitionIdRef = useRef(0);
  const [transition, setTransition] = useState<SwapTransition | null>(null);
  const valueChanged = committedValueRef.current.key !== valueKey;
  const visibleTransition = valueChanged
    ? {
        id: nextTransitionIdRef.current + 1,
        outgoing: committedValueRef.current.value,
      }
    : transition;

  useLayoutEffect(() => {
    if (committedValueRef.current.key === valueKey) {
      committedValueRef.current.value = value;
      return;
    }

    const outgoing = committedValueRef.current.value;
    nextTransitionIdRef.current += 1;
    committedValueRef.current = { key: valueKey, value };
    setTransition({
      id: nextTransitionIdRef.current,
      outgoing,
    });
  }, [value, valueKey]);

  useEffect(() => {
    if (!transition) {
      return;
    }
    const transitionId = transition.id;
    const timeout = window.setTimeout(() => {
      setTransition((current) => current?.id === transitionId ? null : current);
    }, SWAP_DURATION_MS);
    return () => window.clearTimeout(timeout);
  }, [transition]);

  return (
    <span className="composer-value-swap">
      <span
        key={visibleTransition?.id ?? valueKey}
        className={visibleTransition ? "composer-value-enter" : undefined}
      >
        {value}
      </span>
      {visibleTransition && (
        <span
          aria-hidden="true"
          className="composer-value-exit"
          onAnimationEnd={() => {
            setTransition(null);
          }}
        >
          {visibleTransition.outgoing}
        </span>
      )}
    </span>
  );
}
