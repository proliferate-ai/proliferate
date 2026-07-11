/* @vitest-environment jsdom */

import { useRef } from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  useTranscriptStickToBottom,
  type TranscriptStickToBottom,
} from "./useTranscriptStickToBottom";

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

interface HarnessController {
  current: HarnessHandle;
  rerenderInset: (bottomInsetPx: number) => void;
}

function renderHarness(
  onScrollSample = vi.fn(),
  initialBottomInsetPx = 0,
): HarnessController {
  const handle: { current: HarnessHandle | null } = { current: null };

  function Harness({ bottomInsetPx }: { bottomInsetPx: number }) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const api = useTranscriptStickToBottom({
      scrollRef,
      onScrollSample,
      autoFollowBottomInsetPx: bottomInsetPx,
    });
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

  const rendered = render(<Harness bottomInsetPx={initialBottomInsetPx} />);
  // Drain the mount snap (resetForSession is not called on mount; the snap
  // comes from consumers — here we just want a clean queue).
  return {
    get current() {
      return handle.current!;
    },
    rerenderInset(bottomInsetPx: number) {
      rendered.rerender(<Harness bottomInsetPx={bottomInsetPx} />);
    },
  };
}

function setMetrics(el: HTMLElement, metrics: { scrollHeight: number; clientHeight: number; scrollTop: number }) {
  Object.defineProperty(el, "scrollHeight", { value: metrics.scrollHeight, configurable: true });
  Object.defineProperty(el, "clientHeight", { value: metrics.clientHeight, configurable: true });
  el.scrollTop = metrics.scrollTop;
}

/** Mimic AutoHideScrollArea forwarding the viewport's scroll event to the engine. */
function dispatchScroll(handle: { current: HarnessHandle }) {
  act(() => {
    handle.current.api.onViewportScroll(handle.current.viewport);
  });
}

/** A user scroll to a position, then the resulting scroll event reaching the engine. */
function userScroll(handle: { current: HarnessHandle }, scrollTop: number) {
  handle.current.viewport.scrollTop = scrollTop;
  dispatchScroll(handle);
}

describe("useTranscriptStickToBottom", () => {
  it("keeps overlay scroll range manual across resize and visibility glue", () => {
    const handle = renderHarness(vi.fn(), 0);
    const { viewport } = handle.current;
    setMetrics(viewport, { scrollHeight: 1_000, clientHeight: 300, scrollTop: 700 });

    handle.rerenderInset(160);
    setMetrics(viewport, { scrollHeight: 1_160, clientHeight: 300, scrollTop: 700 });

    act(() => {
      handle.current.api.scrollToBottom();
    });
    expect(viewport.scrollTop).toBe(700);

    act(() => {
      fireEvent(document, new Event("visibilitychange"));
      flushRafRound();
    });
    expect(viewport.scrollTop).toBe(700);

    // Once the user deliberately reaches the hard bottom, following keeps the
    // transcript above the overlay on subsequent content growth.
    dispatchScroll(handle);
    userScroll(handle, 860);
    setMetrics(viewport, { scrollHeight: 1_180, clientHeight: 300, scrollTop: 860 });
    act(() => {
      handle.current.api.scrollToBottom();
    });
    expect(viewport.scrollTop).toBe(1_180);
  });

  it("preserves already-consumed range when another composer card stacks", () => {
    const handle = renderHarness(vi.fn(), 100);
    const { viewport } = handle.current;
    setMetrics(viewport, { scrollHeight: 1_100, clientHeight: 300, scrollTop: 0 });

    act(() => {
      handle.current.api.scrollToBottom();
    });
    expect(viewport.scrollTop).toBe(700);
    dispatchScroll(handle);

    // The user manually consumes the first card's 100px range.
    userScroll(handle, 800);

    // A second 60px card appears. The old 100px stays consumed, while only
    // the new 60px remains outside normal auto-follow.
    handle.rerenderInset(160);
    setMetrics(viewport, { scrollHeight: 1_160, clientHeight: 300, scrollTop: 800 });
    act(() => {
      handle.current.api.scrollToBottom();
    });
    expect(viewport.scrollTop).toBe(800);
  });

  it("stays pinned when a consumed overlay is dismissed and the browser clamps to hard bottom", () => {
    const onScrollSample = vi.fn();
    const handle = renderHarness(onScrollSample, 160);
    const { viewport } = handle.current;
    setMetrics(viewport, { scrollHeight: 1_160, clientHeight: 300, scrollTop: 0 });

    act(() => {
      handle.current.api.scrollToBottom();
    });
    expect(viewport.scrollTop).toBe(700);
    dispatchScroll(handle);

    // The user deliberately consumes the overlay range and reaches the hard
    // bottom before the composer card disappears.
    userScroll(handle, 860);
    expect(handle.current.api.isPinnedToBottom).toBe(true);

    // Removing the 160px overlay shrinks scrollHeight and the browser clamps
    // scrollTop upward by the same amount before React layout effects run.
    setMetrics(viewport, { scrollHeight: 1_000, clientHeight: 300, scrollTop: 700 });
    handle.rerenderInset(0);
    dispatchScroll(handle);

    expect(handle.current.api.isPinnedToBottom).toBe(true);
    expect(onScrollSample).toHaveBeenLastCalledWith({ programmatic: true });

    // The natural clamp must not disable subsequent pinned auto-follow.
    setMetrics(viewport, { scrollHeight: 1_040, clientHeight: 300, scrollTop: 700 });
    act(() => {
      handle.current.api.scrollToBottom();
    });
    expect(viewport.scrollTop).toBe(1_040);
  });

  it("still unpins when upward movement after an inset shrink leaves hard bottom", () => {
    const onScrollSample = vi.fn();
    const handle = renderHarness(onScrollSample, 160);
    const { viewport } = handle.current;
    setMetrics(viewport, { scrollHeight: 1_160, clientHeight: 300, scrollTop: 0 });

    act(() => {
      handle.current.api.scrollToBottom();
    });
    dispatchScroll(handle);
    userScroll(handle, 860);

    // Unlike the browser clamp above, this position is still 20px from the
    // new hard bottom, so its upward delta remains genuine user departure.
    setMetrics(viewport, { scrollHeight: 1_000, clientHeight: 300, scrollTop: 680 });
    handle.rerenderInset(0);
    dispatchScroll(handle);

    expect(handle.current.api.isPinnedToBottom).toBe(false);
    expect(onScrollSample).toHaveBeenLastCalledWith({ programmatic: false });
  });

  it("starts pinned", () => {
    const handle = renderHarness();
    expect(handle.current.api.isPinnedToBottom).toBe(true);
  });

  it("unpins immediately on an upward wheel (pre-empts the snap race)", () => {
    const handle = renderHarness();
    setMetrics(handle.current.viewport, { scrollHeight: 1000, clientHeight: 300, scrollTop: 1000 });
    act(() => {
      fireEvent.wheel(handle.current.viewport, { deltaY: -20 });
    });
    expect(handle.current.api.isPinnedToBottom).toBe(false);
    expect(handle.current.api.pinnedRef.current).toBe(false);
  });

  it("unpins on ArrowUp / PageUp / Home keydown", () => {
    for (const key of ["ArrowUp", "PageUp", "Home"]) {
      const handle = renderHarness();
      setMetrics(handle.current.viewport, { scrollHeight: 1000, clientHeight: 300, scrollTop: 1000 });
      act(() => {
        fireEvent.keyDown(handle.current.viewport, { key });
      });
      expect(handle.current.api.isPinnedToBottom).toBe(false);
      cleanup();
    }
  });

  it("does not unpin on a downward wheel", () => {
    const handle = renderHarness();
    setMetrics(handle.current.viewport, { scrollHeight: 1000, clientHeight: 300, scrollTop: 1000 });
    act(() => {
      fireEvent.wheel(handle.current.viewport, { deltaY: 20 });
    });
    expect(handle.current.api.isPinnedToBottom).toBe(true);
  });

  it("stays pinned on an upward wheel when the content is not scrollable", () => {
    // Regression: with content that fits the viewport there is nowhere to
    // scroll, so the wheel fires no scroll event. Unpinning here would strand
    // the engine and show the scroll-to-bottom button while already at bottom.
    const handle = renderHarness();
    setMetrics(handle.current.viewport, { scrollHeight: 300, clientHeight: 300, scrollTop: 0 });
    act(() => {
      fireEvent.wheel(handle.current.viewport, { deltaY: -50 });
    });
    expect(handle.current.api.isPinnedToBottom).toBe(true);
  });

  it("stays pinned on ArrowUp/PageUp/Home when the content is not scrollable", () => {
    for (const key of ["ArrowUp", "PageUp", "Home"]) {
      const handle = renderHarness();
      setMetrics(handle.current.viewport, { scrollHeight: 300, clientHeight: 300, scrollTop: 0 });
      act(() => {
        fireEvent.keyDown(handle.current.viewport, { key });
      });
      expect(handle.current.api.isPinnedToBottom).toBe(true);
      cleanup();
    }
  });

  it("ignores its own programmatic snap, then unpins on a real user scroll", () => {
    const onScrollSample = vi.fn();
    const handle = renderHarness(onScrollSample);
    const { viewport } = handle.current;
    setMetrics(viewport, { scrollHeight: 1000, clientHeight: 300, scrollTop: 0 });

    act(() => {
      handle.current.api.scrollToBottom();
    });
    expect(viewport.scrollTop).toBe(1000);

    // The snap's own scroll event must not flip pin state.
    dispatchScroll(handle);
    expect(handle.current.api.isPinnedToBottom).toBe(true);
    expect(onScrollSample).toHaveBeenCalled();

    // A genuine user scroll up unpins.
    userScroll(handle, 600);
    expect(handle.current.api.isPinnedToBottom).toBe(false);
  });

  it("does not leak the programmatic marker when the write changes nothing (watchdog)", () => {
    const handle = renderHarness();
    const { viewport } = handle.current;
    setMetrics(viewport, { scrollHeight: 1000, clientHeight: 300, scrollTop: 1000 });

    // Write that lands on the same scrollTop -> no scroll event fires.
    act(() => {
      handle.current.api.notifyProgrammaticScroll(() => {
        viewport.scrollTop = 1000;
      });
    });
    // Watchdog clears the marker next frame.
    act(() => {
      flushRafRound();
    });

    userScroll(handle, 500);
    expect(handle.current.api.isPinnedToBottom).toBe(false);
  });

  it("re-pins only within the tight bottom band", () => {
    const handle = renderHarness();
    const { viewport } = handle.current;
    setMetrics(viewport, { scrollHeight: 1000, clientHeight: 300, scrollTop: 1000 });

    act(() => {
      fireEvent.wheel(viewport, { deltaY: -50 });
    });
    expect(handle.current.api.isPinnedToBottom).toBe(false);

    // Land 50px from the bottom (outside the 24px band) -> stays unpinned.
    userScroll(handle, 650);
    expect(handle.current.api.isPinnedToBottom).toBe(false);

    // Land 10px from the bottom (inside the band, moving down) -> re-pins.
    userScroll(handle, 690);
    expect(handle.current.api.isPinnedToBottom).toBe(true);
  });

  it("re-pins and snaps on the scroll-to-bottom button click", () => {
    const handle = renderHarness();
    const { viewport } = handle.current;
    setMetrics(viewport, { scrollHeight: 1000, clientHeight: 300, scrollTop: 0 });

    act(() => {
      fireEvent.wheel(viewport, { deltaY: -50 });
    });
    expect(handle.current.api.isPinnedToBottom).toBe(false);

    act(() => {
      handle.current.api.handleScrollToBottomClick();
    });
    expect(handle.current.api.isPinnedToBottom).toBe(true);
    expect(viewport.scrollTop).toBe(1000);
  });

  it("resetForSession re-pins, snaps, and clears stale direction", () => {
    const handle = renderHarness();
    const { viewport } = handle.current;
    setMetrics(viewport, { scrollHeight: 1000, clientHeight: 300, scrollTop: 400 });

    userScroll(handle, 400);
    expect(handle.current.api.isPinnedToBottom).toBe(false);

    act(() => {
      handle.current.api.resetForSession();
    });
    expect(handle.current.api.isPinnedToBottom).toBe(true);
    expect(viewport.scrollTop).toBe(1000);
  });

  it("glues to the bottom across a visibility-resume measurement backlog", () => {
    const handle = renderHarness();
    const { viewport } = handle.current;
    setMetrics(viewport, { scrollHeight: 1000, clientHeight: 300, scrollTop: 1000 });

    act(() => {
      fireEvent(document, new Event("visibilitychange"));
    });

    // First glue frame snaps to the current bottom.
    act(() => {
      flushRafRound();
    });
    expect(viewport.scrollTop).toBe(1000);

    // Backlog measures in: the bottom grows; the glue loop follows it each frame.
    setMetrics(viewport, { scrollHeight: 2200, clientHeight: 300, scrollTop: 1000 });
    act(() => {
      flushRafRound();
    });
    expect(viewport.scrollTop).toBe(2200);
  });

  it("bails the glue loop if the user scrolls up mid-resume", () => {
    const handle = renderHarness();
    const { viewport } = handle.current;
    setMetrics(viewport, { scrollHeight: 1000, clientHeight: 300, scrollTop: 1000 });

    act(() => {
      fireEvent(document, new Event("visibilitychange"));
    });
    act(() => {
      flushRafRound();
    });

    // User grabs control.
    act(() => {
      fireEvent.wheel(viewport, { deltaY: -100 });
    });
    expect(handle.current.api.isPinnedToBottom).toBe(false);

    // Even though height grows, the bailed loop must not yank the user back.
    setMetrics(viewport, { scrollHeight: 3000, clientHeight: 300, scrollTop: 700 });
    act(() => {
      flushRafRound();
    });
    expect(viewport.scrollTop).toBe(700);
  });
});
