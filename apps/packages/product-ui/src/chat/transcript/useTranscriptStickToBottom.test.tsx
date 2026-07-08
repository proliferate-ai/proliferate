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

interface RenderableHarness {
  current: HarnessHandle;
  setInset: (bottomInsetPx: number) => void;
}

function renderHarness(onScrollSample = vi.fn(), initialInsetPx = 0): RenderableHarness {
  const handle: { current: HarnessHandle | null } = { current: null };

  function Harness({ bottomInsetPx }: { bottomInsetPx: number }) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const api = useTranscriptStickToBottom({ scrollRef, onScrollSample, bottomInsetPx });
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

  const { rerender } = render(<Harness bottomInsetPx={initialInsetPx} />);
  // Drain the mount snap (resetForSession is not called on mount; the snap
  // comes from consumers — here we just want a clean queue).
  const result = handle as unknown as RenderableHarness;
  result.setInset = (bottomInsetPx: number) => {
    act(() => {
      rerender(<Harness bottomInsetPx={bottomInsetPx} />);
    });
  };
  return result;
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

  describe("suppressed pin (bottomInsetPx growth/shrink)", () => {
    it("suppresses the snap when the inset grows while pinned", () => {
      const handle = renderHarness(vi.fn(), 0);
      const { viewport } = handle.current;
      setMetrics(viewport, { scrollHeight: 1000, clientHeight: 300, scrollTop: 1000 });
      expect(handle.current.api.isPinnedToBottom).toBe(true);

      // Dock card grows the bottom inset while pinned: freeze, don't snap.
      handle.setInset(80);

      expect(handle.current.api.isPinnedToBottom).toBe(false);
      expect(handle.current.api.pinnedRef.current).toBe(false);
      // No scroll write happened — the viewport must not have moved.
      expect(viewport.scrollTop).toBe(1000);
    });

    it("restores pin and snaps when the inset shrinks back while suppressed and the user hasn't scrolled", () => {
      const handle = renderHarness(vi.fn(), 0);
      const { viewport } = handle.current;
      setMetrics(viewport, { scrollHeight: 1000, clientHeight: 300, scrollTop: 1000 });

      handle.setInset(80);
      expect(handle.current.api.isPinnedToBottom).toBe(false);

      // Content grew while suppressed too (e.g. streaming continued) — the
      // bottom keeps moving, but the frozen viewport shouldn't have followed.
      setMetrics(viewport, { scrollHeight: 1400, clientHeight: 300, scrollTop: 1000 });

      // Dock card closes: inset shrinks back to 0.
      handle.setInset(0);

      expect(handle.current.api.isPinnedToBottom).toBe(true);
      expect(handle.current.api.pinnedRef.current).toBe(true);
      expect(viewport.scrollTop).toBe(viewport.scrollHeight);
    });

    it("clears suppression on a real user scroll, so a later shrink does not snap", () => {
      const handle = renderHarness(vi.fn(), 0);
      const { viewport } = handle.current;
      setMetrics(viewport, { scrollHeight: 1000, clientHeight: 300, scrollTop: 1000 });

      handle.setInset(80);
      expect(handle.current.api.isPinnedToBottom).toBe(false);

      // The user scrolls (moves away) while suppressed — this must clear
      // suppression regardless of where they land.
      userScroll(handle, 600);
      const scrollTopAfterUserScroll = viewport.scrollTop;

      // Dock card closes: inset shrinks back, but since suppression was
      // cleared by the user's scroll, this must NOT snap.
      handle.setInset(0);

      expect(viewport.scrollTop).toBe(scrollTopAfterUserScroll);
    });

    it("keeps resetForSession's identity stable across inset changes", () => {
      const handle = renderHarness(vi.fn(), 0);
      const firstResetForSession = handle.current.api.resetForSession;

      handle.setInset(40);
      const secondResetForSession = handle.current.api.resetForSession;

      handle.setInset(0);
      const thirdResetForSession = handle.current.api.resetForSession;

      expect(secondResetForSession).toBe(firstResetForSession);
      expect(thirdResetForSession).toBe(firstResetForSession);
    });

    it("does not snap on content growth while suppressed (viewport freeze is intentional)", () => {
      const handle = renderHarness(vi.fn(), 0);
      const { viewport } = handle.current;
      setMetrics(viewport, { scrollHeight: 1000, clientHeight: 300, scrollTop: 1000 });

      handle.setInset(80);
      expect(handle.current.api.isPinnedToBottom).toBe(false);

      // Simulate a tab/window resume glue attempt firing while suppressed —
      // this stands in for any content-driven autoscroll trigger. It must
      // bail without moving the viewport: the freeze while suppressed is a
      // deliberate product decision, not a bug.
      setMetrics(viewport, { scrollHeight: 2200, clientHeight: 300, scrollTop: 1000 });
      act(() => {
        fireEvent(document, new Event("visibilitychange"));
      });
      act(() => {
        flushRafRound();
      });

      expect(viewport.scrollTop).toBe(1000);
      expect(handle.current.api.isPinnedToBottom).toBe(false);
    });
  });
});
