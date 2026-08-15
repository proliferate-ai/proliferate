import { useCallback, type CSSProperties, type WheelEvent as ReactWheelEvent } from "react";
import { chainVerticalWheelScroll } from "#product/primitives/utils/scroll-chain";

/**
 * Wheel handler for a scroller nested inside another scroller. Nested
 * scrollers pair `overscroll-behavior: none` with manual chaining because
 * the CSS alone traps the vertical wheel whenever the cursor rests on the
 * nested scroller at its edge, freezing the surrounding scroll (PRO-258):
 * once the viewport can no longer consume the delta, the remainder is
 * forwarded to the nearest scrollable ancestor.
 */
export function useChainedVerticalWheel(enabled: boolean = true) {
  return useCallback(
    (event: ReactWheelEvent<HTMLElement>) => {
      if (!enabled) {
        return;
      }
      if (chainVerticalWheelScroll(event.currentTarget, event.deltaY)) {
        event.preventDefault();
      }
    },
    [enabled],
  );
}

export function buildOverscrollStyle(
  overscrollBehavior: CSSProperties["overscrollBehavior"],
  overscrollBehaviorX?: CSSProperties["overscrollBehaviorX"],
  overscrollBehaviorY?: CSSProperties["overscrollBehaviorY"],
): CSSProperties {
  return {
    overscrollBehavior,
    ...(overscrollBehaviorX ? { overscrollBehaviorX } : {}),
    ...(overscrollBehaviorY ? { overscrollBehaviorY } : {}),
  } as CSSProperties;
}
