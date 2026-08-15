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

  it("holds the pin on a marker-tolerance miss during growth (no false unpin)", () => {
    // A pinned glue write whose scrollHeight grew between the write and its
    // event: the event's scrollTop no longer matches the recorded marker
    // within the 2px tolerance, so the primary tier misses. The content-growth
    // guard keeps the pin held so the reader is not spuriously unpinned. The
    // event is unattributed (no marker matched, no user intent), so the perf
    // probe samples it as an ordinary non-user scroll.
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
    expect(onScrollSample).toHaveBeenLastCalledWith({ programmatic: false });
  });

  it("holds the pin on an EXPIRED-marker growth event (no false unpin)", () => {
    // The regression this rung must not reintroduce. A pinned snap records an
    // ownership marker, but its single-frame watchdog can expire before the
    // lagging or coalesced scroll event it produced arrives (browsers batch
    // scroll dispatch; several writes can be in flight). When that happens the
    // primary tier (matchByValue) finds an empty queue and the event reaches the
    // pin logic. It must STILL hold the pin, because the bottom-distance opened
    // up from CONTENT GROWTH (scrollHeight increased), not a user displacement —
    // gating the old fallback on marker liveness dropped the pin here, which
    // gates off the content-resize follow and strands the viewport far behind
    // the bottom. The event is unattributed, so the perf probe samples it as an
    // ordinary non-user scroll.
    const onScrollSample = vi.fn();
    const handle = renderHarness(onScrollSample);
    const { viewport } = handle.current;
    setMetrics(viewport, { scrollHeight: 1000, clientHeight: 300, scrollTop: 700 });

    act(() => {
      handle.current.api.notifyProgrammaticScroll(() => {
        viewport.scrollTop = 700;
      });
    });
    // Watchdog expires the marker on the next frame before its event arrives.
    act(() => {
      flushRafRound();
    });
    // The stream grew (scrollHeight 1000 -> 1400) so the settled event lands at
    // 760: 340px from the bottom, well outside the 24px repin band. With no live
    // marker, content growth (not marker liveness) classifies it as our own snap
    // lagging the stream: pin HELD.
    setMetrics(viewport, { scrollHeight: 1400, clientHeight: 300, scrollTop: 760 });
    dispatchScroll(handle);
    expect(onScrollSample).toHaveBeenLastCalledWith({ programmatic: false });
    expect(handle.current.api.isPinnedToBottom).toBe(true);
  });

  it("still unpins on a no-growth displacement while pinned with no live marker (growth discriminates)", () => {
    // The safety boundary of the content-growth guard: a bottom-distance that
    // opens up WITHOUT the content growing is a genuine user displacement, not
    // our own follow, so it must fall through to ordinary pin logic and unpin.
    // This is what keeps a missing or expired marker from swallowing a genuine
    // reader-moving-away scroll.
    const onScrollSample = vi.fn();
    const handle = renderHarness(onScrollSample);
    const { viewport } = handle.current;
    setMetrics(viewport, { scrollHeight: 1000, clientHeight: 300, scrollTop: 700 });

    act(() => {
      handle.current.api.notifyProgrammaticScroll(() => {
        viewport.scrollTop = 700;
      });
    });
    act(() => {
      flushRafRound();
    });
    // Upward move to 400: 300px from the bottom, past the repin band. No marker,
    // upward direction => user-scroll pin logic => unpin.
    setMetrics(viewport, { scrollHeight: 1000, clientHeight: 300, scrollTop: 400 });
    dispatchScroll(handle);
    expect(onScrollSample).toHaveBeenLastCalledWith({ programmatic: false });
    expect(handle.current.api.isPinnedToBottom).toBe(false);
  });

  it("holds the pin when a content SHRINK clamps scrollTop down at the bottom (no false unpin)", () => {
    // WebKit regression seen in the scroll-physics tier: while pinned at the
    // bottom, the virtualizer re-measures a row shorter, scrollHeight drops, and
    // the browser clamps scrollTop DOWN to the new maximum. That clamp reads as
    // an upward delta even though the viewport never left the hard bottom
    // (distance stays 0). Treating it as a user "moving up" dropped the pin and
    // stalled the follow. The content-size-change guard (and the at-bottom guard)
    // must keep the pin held.
    const onScrollSample = vi.fn();
    const handle = renderHarness(onScrollSample);
    const { viewport } = handle.current;

    // Pinned snap to the bottom of a 1534px document (scrollTop clamps to 1134).
    setMetrics(viewport, { scrollHeight: 1534, clientHeight: 400, scrollTop: 1134 });
    act(() => {
      handle.current.api.notifyProgrammaticScroll(() => {
        viewport.scrollTop = 1534;
      });
    });
    // Its event settles at the clamped bottom (1134): matched by the marker.
    setMetrics(viewport, { scrollHeight: 1534, clientHeight: 400, scrollTop: 1134 });
    dispatchScroll(handle);
    act(() => {
      flushRafRound();
    });
    expect(handle.current.api.isPinnedToBottom).toBe(true);

    // A measurement correction shrinks the content by 24px; the browser clamps
    // scrollTop down to the new bottom (1110). distance is still 0 (at bottom)
    // but delta is -24 (looks upward). Must NOT unpin.
    setMetrics(viewport, { scrollHeight: 1510, clientHeight: 400, scrollTop: 1110 });
    dispatchScroll(handle);
    expect(handle.current.api.isPinnedToBottom).toBe(true);
  });
});
