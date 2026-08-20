/* @vitest-environment jsdom */

import { useRef } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  useTranscriptStickToBottom,
  type TranscriptStickToBottom,
} from "#product/hooks/chat/ui/use-transcript-stick-to-bottom";

// Sibling of use-transcript-stick-to-bottom.seat-confirmation.test.tsx, split
// out so neither file crosses the 600-line cap. That file covers seat
// acknowledgment against EVENT-SILENT overwrites and swallowed writes; this one
// covers the seat against an observable native scroll lifecycle still running
// across the acknowledgment boundary.

interface QueuedFrame {
  handle: number;
  callback: FrameRequestCallback;
}

let rafQueue: QueuedFrame[];
let nextHandle: number;

beforeEach(() => {
  nextHandle = 0;
  rafQueue = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    const handle = (nextHandle += 1);
    rafQueue.push({ handle, callback });
    return handle;
  });
  vi.stubGlobal("cancelAnimationFrame", (handle: number) => {
    rafQueue = rafQueue.filter((entry) => entry.handle !== handle);
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function flushRafRound(): void {
  const batch = rafQueue;
  rafQueue = [];
  for (const entry of batch) {
    entry.callback(performance.now());
  }
}

function flushRafToEmpty(limit = 20): void {
  for (let round = 0; rafQueue.length > 0; round += 1) {
    if (round >= limit) {
      throw new Error(`frame scheduler did not drain after ${limit} rounds`);
    }
    act(() => {
      flushRafRound();
    });
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

function setContentHeight(viewport: HTMLElement, scrollHeight: number, clientHeight = 400): void {
  Object.defineProperty(viewport, "scrollHeight", { value: scrollHeight, configurable: true });
  Object.defineProperty(viewport, "clientHeight", { value: clientHeight, configurable: true });
}

describe("prepend seat proof against a running native scroll", () => {
  // The shared WebKit older-history prepend regression. Two independent hosted
  // traces: an unpinned reader at scrollTop ~453 with scrollHeight 5552, an
  // older-history prepend adding exactly 1356px above (scrollHeight -> 6908),
  // then the PAINTED scrollTop decaying monotonically to 0 over ~280ms with no
  // second wheel, no remount and no rebound. The decay is the capture-driving
  // wheel's own momentum continuation, queued BEFORE the prepend.
  //
  // The hole is the acknowledgment boundary. A pass that reads the seat held
  // there releases the anchor and reports settled, which both drains the writer
  // AND drops the non-cancelable protection `onViewportScroll` uses to re-arm
  // glue — so the momentum step landing after that callback has nothing left to
  // correct it and the reader rides the rest of the decay to the physical top.
  // A seated read only counts as seat proof in a frame that saw no native
  // scroll activity.
  it("holds the seat when a momentum step lands below it past the ordinary deadline", () => {
    let clock = 0;
    const nowSpy = vi.spyOn(performance, "now").mockImplementation(() => clock);
    try {
      const handle = renderHarness();
      const { api, viewport } = handle.current;
      setContentHeight(viewport, 5_552);
      viewport.scrollTop = 453;
      act(() => {
        api.setPinned(false);
        api.startAboveChangeCompensation(
          { rowCount: 5, scrollHeight: 5_552, scrollTop: 453 },
          false,
        );
      });
      setContentHeight(viewport, 6_908);
      flushRafToEmpty();
      // Seated at 453 + (6908 - 5552) = 1809. Growth extended the ordinary
      // deadline to t=1000; the owner is dormant with the seat held.
      expect(viewport.scrollTop).toBe(1_809);

      // Past the ordinary deadline the momentum is still running. Step one
      // erodes above the seat and delivers its scroll event; the still-protected
      // owner re-arms glue and the deadline pass corrects back to the seat.
      clock = 1_100;
      viewport.scrollTop = 1_400;
      act(() => {
        api.onViewportScroll(viewport);
      });
      act(() => {
        flushRafRound();
      });
      expect(viewport.scrollTop).toBe(1_809);

      // Step two lands BELOW the seat (1900 > 1809). The seat is a floor, so
      // the pass has nothing to correct and reads the position as held — the
      // read the release boundary used to accept as proof.
      viewport.scrollTop = 1_900;
      act(() => {
        api.onViewportScroll(viewport);
      });
      act(() => {
        flushRafRound();
      });

      // The momentum's remaining decay lands as a compositor-side overwrite
      // with no further scroll event (the trace's silent tail). The retained
      // owner's own continuation must re-seat the reader, then drain.
      viewport.scrollTop = 0;
      flushRafToEmpty();

      expect(handle.current.api.isPinnedToBottom).toBe(false);
      expect(rafQueue).toEqual([]);
      expect(viewport.scrollTop).toBe(1_809);
    } finally {
      nowSpy.mockRestore();
    }
  });

  // The bound. Native scroll activity may only extend seat ownership up to the
  // existing three-second absolute ceiling; it can never keep the writer
  // running indefinitely against a reader who is genuinely scrolling.
  it("still releases at the absolute ceiling while native scroll activity continues", () => {
    let clock = 0;
    const nowSpy = vi.spyOn(performance, "now").mockImplementation(() => clock);
    try {
      const handle = renderHarness();
      const { api, viewport } = handle.current;
      setContentHeight(viewport, 5_552);
      viewport.scrollTop = 453;
      act(() => {
        api.setPinned(false);
        api.startAboveChangeCompensation(
          { rowCount: 5, scrollHeight: 5_552, scrollTop: 453 },
          false,
        );
      });
      setContentHeight(viewport, 6_908);
      flushRafToEmpty();
      expect(viewport.scrollTop).toBe(1_809);

      // Past the ceiling, with a native scroll event still arriving in the very
      // frame the pass runs. The seat is not re-established and no frame is
      // left scheduled.
      clock = 3_100;
      viewport.scrollTop = 1_950;
      act(() => {
        api.onViewportScroll(viewport);
      });
      act(() => {
        api.notifyContentResize();
      });
      viewport.scrollTop = 0;
      flushRafToEmpty();

      expect(rafQueue).toEqual([]);
      expect(viewport.scrollTop).toBe(0);
    } finally {
      nowSpy.mockRestore();
    }
  });
});
