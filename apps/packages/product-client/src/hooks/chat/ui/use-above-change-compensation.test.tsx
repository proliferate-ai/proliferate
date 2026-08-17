/* @vitest-environment jsdom */

import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RefObject } from "react";
import { useAboveChangeCompensation } from "./use-above-change-compensation";
import type { ContentHeightScrollAnchor } from "./transcript-row-list-model";

let rafCallbacks: Array<FrameRequestCallback | null>;
let clockMs: number;

beforeEach(() => {
  rafCallbacks = [];
  clockMs = 1_000;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    rafCallbacks.push(cb);
    return rafCallbacks.length;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    rafCallbacks[id - 1] = null;
  });
  // Deterministic wall clock: the compensation deadline (500ms) reads this, and
  // the upward-intent stamp is compared against the recorded window start.
  vi.spyOn(performance, "now").mockImplementation(() => clockMs);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Run one round of currently-queued rAF callbacks. */
function flushRafRound() {
  const pending = rafCallbacks;
  rafCallbacks = [];
  for (const cb of pending) {
    cb?.(0);
  }
}

interface FakeViewport {
  scrollTop: number;
  scrollHeight: number;
}

function makeHarness(pinned = false) {
  const viewport: FakeViewport = { scrollTop: 100, scrollHeight: 1_000 };
  const scrollRef = { current: viewport as unknown as HTMLDivElement } as RefObject<HTMLDivElement | null>;
  const pinnedRef = { current: pinned } as RefObject<boolean>;
  const userScrollUpIntentAtRef = { current: 0 } as RefObject<number>;
  const notifyProgrammaticScroll = vi.fn((write: () => void) => { write(); });

  const { result } = renderHook(() => useAboveChangeCompensation({
    scrollRef,
    pinnedRef,
    notifyProgrammaticScroll,
    userScrollUpIntentAtRef,
  }));

  // The anchored reading row sat at scrollTop 100 against a 1000px content
  // height; each settling frame grows the content above it.
  const anchor: ContentHeightScrollAnchor = { rowCount: 5, scrollHeight: 1_000, scrollTop: 100 };
  return { viewport, pinnedRef, userScrollUpIntentAtRef, notifyProgrammaticScroll, start: result.current, anchor };
}

describe("useAboveChangeCompensation upward-intent cancel", () => {
  it("re-anchors every frame while the height corrects and the reader holds still", () => {
    const h = makeHarness();
    h.start(h.anchor, true);

    // Frame 1: 40px measured in above the anchor; scrollTop absorbs it.
    h.viewport.scrollHeight = 1_040;
    flushRafRound();
    expect(h.viewport.scrollTop).toBe(140);

    // Frame 2: another 30px corrects; still re-anchored.
    h.viewport.scrollHeight = 1_070;
    flushRafRound();
    expect(h.viewport.scrollTop).toBe(170);

    // Frame 3: a further correction is still absorbed — the loop is live.
    h.viewport.scrollHeight = 1_090;
    flushRafRound();
    expect(h.viewport.scrollTop).toBe(190);
    expect(h.notifyProgrammaticScroll).toHaveBeenCalledTimes(3);
  });

  it("cancels remaining compensation when upward user intent arrives during the window", () => {
    const h = makeHarness();
    h.start(h.anchor, true); // window opens at clock 1000

    h.viewport.scrollHeight = 1_040;
    flushRafRound();
    expect(h.viewport.scrollTop).toBe(140);
    expect(h.notifyProgrammaticScroll).toHaveBeenCalledTimes(1);

    // Genuine upward user intent lands mid-window (stamp > window start).
    clockMs = 1_020;
    h.userScrollUpIntentAtRef.current = clockMs;

    // Next frame: the active gesture wins — no further re-anchor write, and the
    // reader's own scroll position is left untouched.
    h.viewport.scrollHeight = 1_070;
    flushRafRound();
    expect(h.viewport.scrollTop).toBe(140);
    expect(h.notifyProgrammaticScroll).toHaveBeenCalledTimes(1);

    // The loop is dead: later corrections are not re-anchored either.
    h.viewport.scrollHeight = 1_090;
    flushRafRound();
    expect(h.viewport.scrollTop).toBe(140);
    expect(h.notifyProgrammaticScroll).toHaveBeenCalledTimes(1);
  });

  it("does not cancel on upward intent that predates the window (prepend trigger, since stopped)", () => {
    const h = makeHarness();
    // The wheel-up that TRIGGERED the prepend fired before the window opened.
    h.userScrollUpIntentAtRef.current = 990;
    h.start(h.anchor, true); // window opens at clock 1000

    h.viewport.scrollHeight = 1_040;
    flushRafRound();
    expect(h.viewport.scrollTop).toBe(140);

    // A reader who scrolled up to cause the prepend and then holds still is
    // still compensated frame after frame.
    h.viewport.scrollHeight = 1_070;
    flushRafRound();
    expect(h.viewport.scrollTop).toBe(170);
    expect(h.notifyProgrammaticScroll).toHaveBeenCalledTimes(2);
  });

  it("does not cancel on downward intent (downward never stamps the upward clock)", () => {
    const h = makeHarness();
    h.start(h.anchor, true);

    h.viewport.scrollHeight = 1_040;
    flushRafRound();
    expect(h.viewport.scrollTop).toBe(140);

    // Downward intent leaves userScrollUpIntentAtRef at 0, so the loop survives.
    clockMs = 1_030;
    h.viewport.scrollHeight = 1_070;
    flushRafRound();
    expect(h.viewport.scrollTop).toBe(170);
    expect(h.notifyProgrammaticScroll).toHaveBeenCalledTimes(2);
  });

  it("a PREPEND window (not cancelable) keeps compensating through continued upward intent", () => {
    const h = makeHarness();
    // Prepend compensation is armed non-cancelable: the reader requested it by
    // scrolling to the top, so the reading row must hold even as the SAME upward
    // gesture keeps firing during the window (the webkit wheelToTop scenario).
    h.start(h.anchor, false);

    h.viewport.scrollHeight = 1_040;
    flushRafRound();
    expect(h.viewport.scrollTop).toBe(140);

    // Continued upward intent mid-window would cancel a cancelable window; a
    // prepend window ignores it and keeps absorbing the added-above corrections.
    clockMs = 1_020;
    h.userScrollUpIntentAtRef.current = clockMs;

    h.viewport.scrollHeight = 1_070;
    flushRafRound();
    expect(h.viewport.scrollTop).toBe(170);
    expect(h.notifyProgrammaticScroll).toHaveBeenCalledTimes(2);
  });

  // Deterministic negative control for the CI webkit prepend defect (PRO-187,
  // r3): "scrollTop Expected > 150 / Received 0". The freshly-mounted older
  // rows' estimate-to-measured correction can make the reported scrollHeight
  // dip transiently (and, on a real engine, the browser's own scrollTop clamp
  // can fire during that dip) before recovering to its real, taller value. A
  // dip sampled on the LAST tick before the deadline must never jump the
  // reader back toward the freshly-prepended top.
  // NEGATIVE CONTROL: remove the `floorRef` monotonic tracking and the
  // forward-only `if (target > viewport.scrollTop)` guard, computing the
  // target directly from the dipped `viewport.scrollHeight` instead, and the
  // last assertion here fails (scrollTop drops back toward 0).
  it("survives a late transient scrollHeight dip (and browser scrollTop clamp) on the final tick before the deadline", () => {
    const h = makeHarness();
    h.start(h.anchor, false);

    // The rows measure in taller: scrollTop absorbs the full added-above delta.
    h.viewport.scrollHeight = 1_600;
    flushRafRound();
    expect(h.viewport.scrollTop).toBe(700);

    // A transient measured-swap dip lands on the final tick before the
    // deadline: the reported total drops back near its pre-prepend value and
    // the browser's own clamp (simulated here) forces scrollTop down with it.
    clockMs = 1_499;
    h.viewport.scrollHeight = 1_010;
    h.viewport.scrollTop = 5;
    flushRafRound();
    // The floor (1600) holds; scrollTop is re-raised forward, never released
    // backward toward the dip.
    expect(h.viewport.scrollTop).toBe(700);

    // Deadline lapses on the next tick; no further ticks run.
    clockMs = 1_501;
    flushRafRound();
    expect(h.viewport.scrollTop).toBe(700);
  });
});
