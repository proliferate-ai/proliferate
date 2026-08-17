/* @vitest-environment jsdom */

// Deterministic negative control for the r4 prepend-anchoring CI defect
// (PRO-187): older-history prepend under-absorbed ~39px of added-above height on
// a loaded chromium runner (scrollTopDelta 550 vs > 589.2). The freshly-mounted
// older rows keep correcting their estimated heights taller for several frames
// after the prepend; the forced-glue window's eager quiet-frame termination
// ended a frame early, and the pre-fix writer only compensated while that window
// was open (`isGluing`), so the last correction that arrived via an isolated
// ResizeObserver growth was never absorbed. The fix gates compensation on a
// wall-clock deadline instead, so the single frame pass keeps absorbing every
// correction — glue window open or not — until it lapses. This exercises exactly
// that "correction arrives after glue ended" sequence with stubbed rAF, so it is
// deterministic where the browser-tier repro is CI-scheduling-dependent.

import { useRef } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  useTranscriptStickToBottom,
  type TranscriptStickToBottom,
} from "./use-transcript-stick-to-bottom";

let rafCallbacks: Array<FrameRequestCallback | null>;

beforeEach(() => {
  rafCallbacks = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    rafCallbacks.push(cb);
    return rafCallbacks.length;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    rafCallbacks[id - 1] = null;
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Run one round of currently-queued rAF callbacks (callbacks they schedule run on the next flush). */
function flushRafRound() {
  const pending = rafCallbacks;
  rafCallbacks = [];
  for (const cb of pending) {
    cb?.(0);
  }
}

interface HarnessHandle {
  api: TranscriptStickToBottom;
  viewport: HTMLDivElement;
}

function renderHarness(): { current: HarnessHandle } {
  const handle: { current: HarnessHandle | null } = { current: null };

  function Harness() {
    const scrollRef = useRef<HTMLDivElement>(null);
    const api = useTranscriptStickToBottom({ scrollRef, onScrollSample: vi.fn() });
    return (
      <div
        ref={(node) => {
          scrollRef.current = node;
          if (node) {
            handle.current = { api, viewport: node };
          }
        }}
        data-testid="viewport"
      />
    );
  }

  render(<Harness />);
  return {
    get current() {
      return handle.current!;
    },
  };
}

function setContentHeight(el: HTMLElement, scrollHeight: number, clientHeight = 400) {
  Object.defineProperty(el, "scrollHeight", { value: scrollHeight, configurable: true });
  Object.defineProperty(el, "clientHeight", { value: clientHeight, configurable: true });
}

describe("useTranscriptStickToBottom above-change compensation (PRO-187, r4)", () => {
  it("absorbs a measurement correction that arrives AFTER the glue window ended", () => {
    const handle = renderHarness();
    const { viewport, api } = handle.current;
    setContentHeight(viewport, 2000);
    viewport.scrollTop = 1000;

    // A prepend leaves the reader unpinned with an anchor captured at request
    // time (the height/top before the older rows mounted).
    act(() => {
      api.setPinned(false);
      api.startAboveChangeCompensation({ rowCount: 5, scrollHeight: 2000, scrollTop: 1000 }, false);
    });

    // The forced-glue window runs, sees the height hold stable, and terminates on
    // its single quiet frame (two glue ticks: one baselines the height, the next
    // observes it unchanged and ends). No measurement correction landed yet.
    act(() => {
      flushRafRound();
    });
    act(() => {
      flushRafRound();
    });

    // NOW the freshly-mounted older rows correct their estimated heights taller:
    // scrollHeight grows by 400px above the viewport, reported by the content
    // ResizeObserver as an isolated growth AFTER the glue window already closed.
    setContentHeight(viewport, 2400);
    act(() => {
      api.notifyContentResize();
    });

    // The single frame pass still owns this write (deadline not lapsed): scrollTop
    // absorbs the full added-above delta so the reading row stays fixed.
    //   scrollTop = anchor.scrollTop + (scrollHeight - anchor.scrollHeight)
    //             = 1000 + (2400 - 2000) = 1400
    // NEGATIVE CONTROL: gate this compensation on `isGluing` again (the pre-fix
    // behavior) and this write never happens — scrollTop stays 1000 and the
    // reader drifts down by the lost 400px, exactly the CI under-absorption.
    expect(viewport.scrollTop).toBe(1400);
  });

  it("stops compensating once the anchor deadline lapses (below-viewport growth moves the reader)", () => {
    let clock = 0;
    const nowSpy = vi.spyOn(performance, "now").mockImplementation(() => clock);
    try {
      const handle = renderHarness();
      const { viewport, api } = handle.current;
      setContentHeight(viewport, 2000);
      viewport.scrollTop = 1000;

      act(() => {
        api.setPinned(false);
        api.startAboveChangeCompensation({ rowCount: 5, scrollHeight: 2000, scrollTop: 1000 }, false);
      });
      act(() => {
        flushRafRound();
      });

      // Advance the clock well past the compensation deadline, then ordinary
      // content growth below the viewport arrives. The stale anchor must NOT
      // re-anchor the reader: the frame pass clears it and writes nothing.
      clock = 2000;
      viewport.scrollTop = 1000;
      setContentHeight(viewport, 2600);
      act(() => {
        api.notifyContentResize();
      });

      expect(viewport.scrollTop).toBe(1000);
    } finally {
      nowSpy.mockRestore();
    }
  });
});

describe("above-change compensation cancels on upward user intent (PRO-187, r4)", () => {
  it("stops re-anchoring the instant genuine upward intent arrives during the window", () => {
    const handle = renderHarness();
    const { viewport, api } = handle.current;
    setContentHeight(viewport, 2000);
    viewport.scrollTop = 1000;

    act(() => {
      api.setPinned(false);
      api.startAboveChangeCompensation({ rowCount: 5, scrollHeight: 2000, scrollTop: 1000 }, true);
    });
    act(() => { flushRafRound(); });
    act(() => { flushRafRound(); });

    // The unpinned reader scrolls UP during the compensation window. The active
    // gesture wins: the anchor is dropped and no later correction re-anchors.
    act(() => { api.notifyUserScrollIntent(-1); });

    setContentHeight(viewport, 2400);
    act(() => { api.notifyContentResize(); });

    // NEGATIVE CONTROL: remove the `compensationAnchorRef.current = null` on
    // upward intent and this write lands at 1400 (per-frame re-anchor), dragging
    // the reader back against their scroll. With the cancel, scrollTop is left
    // exactly where the user's gesture put it.
    expect(viewport.scrollTop).toBe(1000);
  });

  it("does NOT cancel on downward intent (only upward is a leave signal)", () => {
    const handle = renderHarness();
    const { viewport, api } = handle.current;
    setContentHeight(viewport, 2000);
    viewport.scrollTop = 1000;

    act(() => {
      api.setPinned(false);
      api.startAboveChangeCompensation({ rowCount: 5, scrollHeight: 2000, scrollTop: 1000 }, true);
    });
    act(() => { flushRafRound(); });
    act(() => { flushRafRound(); });

    act(() => { api.notifyUserScrollIntent(1); });

    setContentHeight(viewport, 2400);
    act(() => { api.notifyContentResize(); });

    // Downward intent never clears the anchor: compensation still absorbs the
    // added-above delta (1000 + (2400 - 2000)).
    expect(viewport.scrollTop).toBe(1400);
  });

  it("does NOT cancel on upward intent that predates the window (prepend trigger, since stopped)", () => {
    const handle = renderHarness();
    const { viewport, api } = handle.current;
    setContentHeight(viewport, 2000);
    viewport.scrollTop = 1000;

    // The wheel-up that TRIGGERED the prepend fires BEFORE the anchor is armed.
    act(() => { api.notifyUserScrollIntent(-1); });

    act(() => {
      api.setPinned(false);
      api.startAboveChangeCompensation({ rowCount: 5, scrollHeight: 2000, scrollTop: 1000 }, true);
    });
    act(() => { flushRafRound(); });
    act(() => { flushRafRound(); });

    setContentHeight(viewport, 2400);
    act(() => { api.notifyContentResize(); });

    // A reader who scrolled up to cause the prepend and then holds still is still
    // compensated: the pre-window intent cleared no live anchor.
    expect(viewport.scrollTop).toBe(1400);
  });

  it("a PREPEND window (not cancelable) keeps compensating through continued upward intent", () => {
    const handle = renderHarness();
    const { viewport, api } = handle.current;
    setContentHeight(viewport, 2000);
    viewport.scrollTop = 1000;

    // Prepend compensation is armed NON-cancelable (the reader requested it by
    // scrolling to the top). This is the webkit wheelToTop scenario: upward
    // intent keeps firing through the settle and must NOT strand the reader.
    act(() => {
      api.setPinned(false);
      api.startAboveChangeCompensation({ rowCount: 5, scrollHeight: 2000, scrollTop: 1000 }, false);
    });
    act(() => { flushRafRound(); });
    act(() => { flushRafRound(); });

    act(() => { api.notifyUserScrollIntent(-1); });

    setContentHeight(viewport, 2400);
    act(() => { api.notifyContentResize(); });

    // NEGATIVE CONTROL: arm this window cancelable (true) and the upward intent
    // clears the anchor, leaving scrollTop at 1000 — the exact webkit prepend
    // regression (reader stranded near the newly prepended top).
    expect(viewport.scrollTop).toBe(1400);
  });
});
