/* @vitest-environment jsdom */

// Split out of use-transcript-stick-to-bottom.test.tsx (repo-shape max-lines):
// the ownership-marker queue scenarios (PRO-187) reuse the same harness shape
// as the main suite; duplicated here rather than shared so this file stays
// self-contained like the PRO-175 session-stamp split.

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

interface HarnessController {
  current: HarnessHandle;
}

function renderHarness(onScrollSample = vi.fn()): HarnessController {
  const handle: { current: HarnessHandle | null } = { current: null };

  function Harness() {
    const scrollRef = useRef<HTMLDivElement>(null);
    const api = useTranscriptStickToBottom({
      scrollRef,
      onScrollSample,
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

  render(<Harness />);
  return {
    get current() {
      return handle.current!;
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

describe("useTranscriptStickToBottom ownership markers (PRO-187)", () => {
  it("consumes multiple in-flight markers by value, including coalesced and reversed delivery", () => {
    // The glue loop writes faster than the browser dispatches scroll events,
    // so several programmatic writes can await their events at once, and the
    // browser may coalesce them into a single dispatched event or (in theory)
    // deliver them out of write order. The queue is matched by VALUE
    // (findIndex on expectedTop), not by FIFO position, so none of that can
    // misclassify an event or leak a marker into the next user scroll.
    const onScrollSample = vi.fn();
    const handle = renderHarness(onScrollSample);
    const { viewport } = handle.current;
    setMetrics(viewport, { scrollHeight: 1000, clientHeight: 300, scrollTop: 700 });

    // Two writes land distinct scrollTops before either event dispatches.
    act(() => {
      handle.current.api.notifyProgrammaticScroll(() => {
        viewport.scrollTop = 650;
      });
    });
    act(() => {
      handle.current.api.notifyProgrammaticScroll(() => {
        viewport.scrollTop = 700;
      });
    });

    // Coalesced delivery: the browser fires only ONE scroll event for the
    // final settled position (700), never dispatching one for the
    // intermediate 650. findIndex must still find the matching (second)
    // marker by value rather than assuming the first queue entry is next.
    viewport.scrollTop = 700;
    dispatchScroll(handle);
    expect(handle.current.api.isPinnedToBottom).toBe(true);
    expect(onScrollSample).toHaveBeenLastCalledWith({ programmatic: true });

    // The 650 marker is still live (its event was coalesced away, never
    // dispatched) and will expire via the watchdog rather than ever matching
    // another event.
    act(() => {
      flushRafRound();
    });

    // A subsequent genuine user scroll must not be misclassified by the
    // leftover (now-expired) marker.
    userScroll(handle, 400);
    expect(handle.current.api.isPinnedToBottom).toBe(false);
    expect(onScrollSample).toHaveBeenLastCalledWith({ programmatic: false });
  });

  it("matches queued markers by value even when events arrive in reverse write order", () => {
    const onScrollSample = vi.fn();
    const handle = renderHarness(onScrollSample);
    const { viewport } = handle.current;
    setMetrics(viewport, { scrollHeight: 1000, clientHeight: 300, scrollTop: 700 });

    // Write order: 600, then 700.
    act(() => {
      handle.current.api.notifyProgrammaticScroll(() => {
        viewport.scrollTop = 600;
      });
    });
    act(() => {
      handle.current.api.notifyProgrammaticScroll(() => {
        viewport.scrollTop = 700;
      });
    });

    // Events dispatch in the REVERSE order (700 first, then 600). A queue
    // matched by position (shift/FIFO) would wrongly pair the 700 event with
    // the first-written 600 marker and miss; matching by value (findIndex on
    // expectedTop) pairs each event with its own marker regardless of order.
    viewport.scrollTop = 700;
    dispatchScroll(handle);
    expect(handle.current.api.isPinnedToBottom).toBe(true);
    expect(onScrollSample).toHaveBeenLastCalledWith({ programmatic: true });

    viewport.scrollTop = 600;
    dispatchScroll(handle);
    expect(handle.current.api.isPinnedToBottom).toBe(true);
    expect(onScrollSample).toHaveBeenLastCalledWith({ programmatic: true });

    // Both consumed: the next genuine user scroll unpins.
    userScroll(handle, 400);
    expect(handle.current.api.isPinnedToBottom).toBe(false);
  });

  it("classifies a marker-tolerance miss during growth as programmatic (no false unpin)", () => {
    // A pinned glue write whose scrollHeight grew between the write and its
    // event: the event's scrollTop no longer matches the recorded marker
    // within tolerance. The downward-while-pinned fallback tier keeps it
    // programmatic so the reader is not spuriously unpinned.
    const onScrollSample = vi.fn();
    const handle = renderHarness(onScrollSample);
    const { viewport } = handle.current;
    setMetrics(viewport, { scrollHeight: 1000, clientHeight: 300, scrollTop: 700 });

    act(() => {
      handle.current.api.notifyProgrammaticScroll(() => {
        viewport.scrollTop = 700;
      });
    });
    // Content grows above/at the write; the event fires further down than the
    // recorded 700, outside the 2px tolerance.
    setMetrics(viewport, { scrollHeight: 1400, clientHeight: 300, scrollTop: 760 });
    dispatchScroll(handle);

    expect(handle.current.api.isPinnedToBottom).toBe(true);
    expect(onScrollSample).toHaveBeenLastCalledWith({ programmatic: true });
  });

  it("classifies a near-marker event as programmatic while live, and lets it fall through once expired", () => {
    // Contrast test: the SAME near-marker event, once with the marker live
    // (primary tier matches, pin held) and once after the watchdog has
    // expired it (queue empty, so the primary AND fallback tiers are both
    // skipped and the event reaches ordinary pin logic). No user intent is
    // claimed in either arm, so the marker's liveness is the only variable
    // that can explain the diverging outcome.
    const onScrollSampleLive = vi.fn();
    const liveHandle = renderHarness(onScrollSampleLive);
    setMetrics(liveHandle.current.viewport, { scrollHeight: 1000, clientHeight: 300, scrollTop: 700 });

    act(() => {
      liveHandle.current.api.notifyProgrammaticScroll(() => {
        liveHandle.current.viewport.scrollTop = 650;
      });
    });
    // Marker is live: the event lands within tolerance of its expectedTop (650).
    liveHandle.current.viewport.scrollTop = 650;
    dispatchScroll(liveHandle);
    expect(onScrollSampleLive).toHaveBeenLastCalledWith({ programmatic: true });
    expect(liveHandle.current.api.isPinnedToBottom).toBe(true);

    const onScrollSampleExpired = vi.fn();
    const expiredHandle = renderHarness(onScrollSampleExpired);
    setMetrics(expiredHandle.current.viewport, { scrollHeight: 1000, clientHeight: 300, scrollTop: 700 });

    act(() => {
      expiredHandle.current.api.notifyProgrammaticScroll(() => {
        expiredHandle.current.viewport.scrollTop = 650;
      });
    });
    // Watchdog expires the marker on the next frame before its event arrives.
    act(() => {
      flushRafRound();
    });
    // The identical event (top === 650, the stale expectedTop) now has no
    // live marker to match: it falls through both the primary and fallback
    // tiers into ordinary pin logic. distance-from-bottom (50px) exceeds
    // repinThresholdPx (24px), so it unpins — the opposite of the live arm,
    // proving the event was not swallowed by a stale marker.
    expiredHandle.current.viewport.scrollTop = 650;
    dispatchScroll(expiredHandle);
    expect(onScrollSampleExpired).toHaveBeenLastCalledWith({ programmatic: false });
    expect(expiredHandle.current.api.isPinnedToBottom).toBe(false);
  });

  it("engages the fallback tier only when a marker is live (downward-while-pinned)", () => {
    // Same downward-while-pinned scroll event, contrasted with and without a
    // live marker. Without a marker the H2 fallback (gated behind
    // `queue.length > 0`) must never engage, so the event is classified by
    // ordinary pin logic (not swallowed as programmatic). With a marker
    // present whose exact landing missed tolerance (scrollHeight changed),
    // the same shape of event IS caught by H2.
    const onScrollSampleNoMarker = vi.fn();
    const noMarkerHandle = renderHarness(onScrollSampleNoMarker);
    setMetrics(noMarkerHandle.current.viewport, { scrollHeight: 1000, clientHeight: 300, scrollTop: 700 });

    // No marker in flight: a small downward move while pinned, dispatched as
    // an ordinary (unattributed) scroll event.
    noMarkerHandle.current.viewport.scrollTop = 705;
    dispatchScroll(noMarkerHandle);
    // Still within the repin band, so pin state doesn't change either way —
    // the load-bearing assertion is that it was NOT attributed to the H2
    // fallback tier, which only exists behind a live marker.
    expect(onScrollSampleNoMarker).toHaveBeenLastCalledWith({ programmatic: false });
    expect(noMarkerHandle.current.api.isPinnedToBottom).toBe(true);

    const onScrollSampleWithMarker = vi.fn();
    const withMarkerHandle = renderHarness(onScrollSampleWithMarker);
    const { viewport } = withMarkerHandle.current;
    setMetrics(viewport, { scrollHeight: 1000, clientHeight: 300, scrollTop: 700 });

    act(() => {
      withMarkerHandle.current.api.notifyProgrammaticScroll(() => {
        viewport.scrollTop = 700;
      });
    });
    // scrollHeight changes between write and event, so the event's downward
    // landing (705) misses the marker's expectedTop (700) by more than the
    // 2px tolerance — only the H2 fallback (gated on a live marker) can
    // classify it as programmatic.
    setMetrics(viewport, { scrollHeight: 1005, clientHeight: 300, scrollTop: 705 });
    dispatchScroll(withMarkerHandle);
    expect(onScrollSampleWithMarker).toHaveBeenLastCalledWith({ programmatic: true });
    expect(withMarkerHandle.current.api.isPinnedToBottom).toBe(true);
  });
});
