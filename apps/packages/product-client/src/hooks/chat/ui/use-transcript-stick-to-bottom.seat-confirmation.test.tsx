/* @vitest-environment jsdom */

import { useRef } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  useTranscriptStickToBottom,
  type TranscriptStickToBottom,
} from "#product/hooks/chat/ui/use-transcript-stick-to-bottom";

interface QueuedFrame {
  handle: number;
  callback: FrameRequestCallback;
}

let cancelledHandles: number[];
let nextHandle: number;
let rafQueue: QueuedFrame[];

beforeEach(() => {
  cancelledHandles = [];
  nextHandle = 0;
  rafQueue = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    const handle = (nextHandle += 1);
    rafQueue.push({ handle, callback });
    return handle;
  });
  vi.stubGlobal("cancelAnimationFrame", (handle: number) => {
    cancelledHandles.push(handle);
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

function installCssomScrollTopClamp(viewport: HTMLElement, initialTop: number): void {
  let top = initialTop;
  Object.defineProperty(viewport, "scrollTop", {
    configurable: true,
    get: () => {
      top = Math.min(top, Math.max(0, viewport.scrollHeight - viewport.clientHeight));
      return top;
    },
    set: (nextTop: number) => {
      const maxTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
      top = Math.min(Math.max(0, nextTop), maxTop);
    },
  });
}

describe("non-cancelable prepend seat confirmation", () => {
  it("reconciles capture/install erosion and two event-silent post-pass overwrites", () => {
    const handle = renderHarness();
    const { api, viewport } = handle.current;
    setContentHeight(viewport, 5_552);
    viewport.scrollTop = 425;
    const capturedAnchor = {
      rowCount: 5,
      scrollHeight: viewport.scrollHeight,
      scrollTop: viewport.scrollTop,
    };

    // Match the hosted WebKit trace: native position erosion begins before the
    // layout effect installs the captured prepend anchor.
    viewport.scrollTop = 97;
    setContentHeight(viewport, 6_908);
    act(() => {
      api.setPinned(false);
      api.startAboveChangeCompensation(capturedAnchor, false);
    });

    // The first writer establishes 425 + (6908 - 5552) = 1781. The compositor
    // silently overwrites it after the callback, without a scroll/resize signal.
    act(() => {
      flushRafRound();
    });
    expect(viewport.scrollTop).toBe(1_781);
    viewport.scrollTop = 0;

    // Overwrite the stable-height quiet-ending pass too. Current v1.2 stops
    // here; v1.3 must keep the sole writer alive until a later seated pass
    // acknowledges that the correction survived.
    act(() => {
      flushRafRound();
    });
    expect(viewport.scrollTop).toBe(1_781);
    viewport.scrollTop = 0;
    flushRafToEmpty();

    expect(handle.current.api.isPinnedToBottom).toBe(false);
    expect(cancelledHandles).toEqual([]);
    expect(rafQueue).toEqual([]);
    expect(viewport.scrollTop).toBe(1_781);
  });

  it("protects a non-cancelable owner before its first writer pass", () => {
    const handle = renderHarness();
    const { api, viewport } = handle.current;
    setContentHeight(viewport, 5_552);
    viewport.scrollTop = 425;
    act(() => {
      api.setPinned(false);
      api.startAboveChangeCompensation(
        { rowCount: 5, scrollHeight: 5_552, scrollTop: 425 },
        false,
      );
      api.notifyUserScrollIntent(-1);
      api.cancelFramePipeline();
    });

    expect(cancelledHandles).toEqual([]);
    expect(rafQueue.length).toBeGreaterThan(0);
    setContentHeight(viewport, 6_908);
    flushRafToEmpty();
    expect(viewport.scrollTop).toBe(1_781);
    expect(rafQueue).toEqual([]);
  });

  it("expires a never-initialized owner at its ordinary deadline", () => {
    let clock = 0;
    const nowSpy = vi.spyOn(performance, "now").mockImplementation(() => clock);
    try {
      const handle = renderHarness();
      const { api, viewport } = handle.current;
      setContentHeight(viewport, 5_552);
      viewport.scrollTop = 425;
      act(() => {
        api.setPinned(false);
        api.startAboveChangeCompensation(
          { rowCount: 5, scrollHeight: 5_552, scrollTop: 425 },
          false,
        );
      });

      // No writer initialized an absolute record. Once the ordinary deadline
      // lapses, genuine input clears this anchor rather than granting it a new
      // three-second window from a delayed first pass.
      clock = 600;
      viewport.scrollTop = 200;
      const cancellationsBeforeTakeover = cancelledHandles.length;
      act(() => {
        api.notifyUserScrollIntent(-1);
        api.cancelFramePipeline();
        api.onViewportScroll(viewport);
      });
      expect(cancelledHandles.length).toBeGreaterThan(cancellationsBeforeTakeover);
      expect(rafQueue).toEqual([]);

      setContentHeight(viewport, 6_908);
      act(() => {
        api.notifyContentResize();
      });
      flushRafToEmpty();
      expect(viewport.scrollTop).toBe(200);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("retains an ordinary-deadline correction through silent overwrite until acknowledgment", () => {
    let clock = 0;
    const nowSpy = vi.spyOn(performance, "now").mockImplementation(() => clock);
    try {
      const handle = renderHarness();
      const { api, viewport } = handle.current;
      setContentHeight(viewport, 5_552);
      viewport.scrollTop = 425;

      act(() => {
        api.setPinned(false);
        api.startAboveChangeCompensation(
          { rowCount: 5, scrollHeight: 5_552, scrollTop: 425 },
          false,
        );
      });
      setContentHeight(viewport, 6_908);
      flushRafToEmpty();
      expect(viewport.scrollTop).toBe(1_781);

      // Growth extended the ordinary deadline to t=1000. At t=1100 the browser
      // has displaced the viewport below the established seat. The synchronous
      // deadline pass corrects, then its write is silently lost after return.
      clock = 1_100;
      viewport.scrollTop = 0;
      act(() => {
        api.notifyContentResize();
      });
      expect(viewport.scrollTop).toBe(1_781);
      // A trailing input listener can run after the ordinary deadline pass.
      // Non-cancelable ownership must protect the owed verifier until the
      // lifecycle itself acknowledges or absolutely releases the anchor.
      act(() => {
        api.cancelFramePipeline();
      });
      viewport.scrollTop = 0;

      flushRafToEmpty();

      expect(handle.current.api.isPinnedToBottom).toBe(false);
      expect(rafQueue).toEqual([]);
      expect(viewport.scrollTop).toBe(1_781);
      expect(cancelledHandles).toEqual([]);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("retains a clamped deadline seat through cancel until height recovery", () => {
    let clock = 0;
    const nowSpy = vi.spyOn(performance, "now").mockImplementation(() => clock);
    try {
      const handle = renderHarness();
      const { api, viewport } = handle.current;
      setContentHeight(viewport, 5_552);
      installCssomScrollTopClamp(viewport, 425);

      act(() => {
        api.setPinned(false);
        api.startAboveChangeCompensation(
          { rowCount: 5, scrollHeight: 5_552, scrollTop: 425 },
          false,
        );
      });
      setContentHeight(viewport, 6_908);
      flushRafToEmpty();
      expect(viewport.scrollTop).toBe(1_781);

      // A temporary measured-height dip makes the established seat unreachable:
      // CSSOM clamps both the live position and the attempted forward write to
      // 1600. No position write landed, but the non-cancelable owner remains.
      clock = 1_100;
      setContentHeight(viewport, 2_000);
      act(() => {
        api.notifyContentResize();
      });
      expect(viewport.scrollTop).toBe(1_600);
      const queuedBeforeCancel = rafQueue.map((entry) => entry.handle);
      expect(queuedBeforeCancel.length).toBeGreaterThan(0);
      act(() => {
        api.cancelFramePipeline();
      });
      expect(cancelledHandles).toEqual([]);
      expect(rafQueue.map((entry) => entry.handle)).toEqual(queuedBeforeCancel);

      // The normal ResizeObserver notification for height recovery re-enters
      // the retained owner. Its correction advances, then a later pass observes
      // the seat held and releases ownership.
      setContentHeight(viewport, 6_908);
      act(() => {
        api.notifyContentResize();
      });
      expect(viewport.scrollTop).toBe(1_781);
      flushRafToEmpty();
      expect(rafQueue).toEqual([]);

      // Once acknowledged, a later resize has no prepend owner and the normal
      // synchronous cancel seam may discard its frame guard.
      viewport.scrollTop = 0;
      act(() => {
        api.notifyContentResize();
        api.cancelFramePipeline();
      });
      expect(viewport.scrollTop).toBe(0);
      expect(rafQueue).toEqual([]);
      expect(cancelledHandles.length).toBeGreaterThan(0);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("clears a prepend owner when deliberate repin supersedes it", () => {
    let clock = 0;
    const nowSpy = vi.spyOn(performance, "now").mockImplementation(() => clock);
    try {
      const handle = renderHarness();
      const { api, viewport } = handle.current;
      setContentHeight(viewport, 5_552);
      viewport.scrollTop = 425;
      act(() => {
        api.setPinned(false);
        api.startAboveChangeCompensation(
          { rowCount: 5, scrollHeight: 5_552, scrollTop: 425 },
          false,
        );
      });
      setContentHeight(viewport, 6_908);
      act(() => {
        flushRafRound();
      });
      expect(viewport.scrollTop).toBe(1_781);

      act(() => {
        api.setPinned(true);
      });
      flushRafToEmpty();
      expect(viewport.scrollTop).toBe(6_908);

      // Past the original absolute ceiling, queue a normal pinned frame guard,
      // then deliberately unpin. The old prepend owner must neither protect the
      // cancel seam nor revive its seat on a later ResizeObserver delivery.
      clock = 3_100;
      act(() => {
        api.notifyContentResize();
      });
      const cancellationsBeforeUnpin = cancelledHandles.length;
      viewport.scrollTop = 300;
      act(() => {
        api.notifyUserScrollIntent(-1);
        api.cancelFramePipeline();
      });
      expect(cancelledHandles.length).toBeGreaterThan(cancellationsBeforeUnpin);
      flushRafToEmpty();
      setContentHeight(viewport, 7_000);
      act(() => {
        api.notifyContentResize();
      });
      flushRafToEmpty();
      expect(viewport.scrollTop).toBe(300);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("clears a drained owner at the event-silent scroll-to-bottom boundary", () => {
    let clock = 0;
    const nowSpy = vi.spyOn(performance, "now").mockImplementation(() => clock);
    try {
      const handle = renderHarness();
      const { api, viewport } = handle.current;
      setContentHeight(viewport, 5_552);
      viewport.scrollTop = 425;
      act(() => {
        api.setPinned(false);
        api.startAboveChangeCompensation(
          { rowCount: 5, scrollHeight: 5_552, scrollTop: 425 },
          false,
        );
      });
      setContentHeight(viewport, 6_908);
      flushRafToEmpty();
      expect(viewport.scrollTop).toBe(1_781);
      expect(rafQueue).toEqual([]);

      // The real button repins after glue is fully drained. Do not deliver a
      // scroll event or request a writer pass; synchronous repin itself must
      // supersede the dormant prepend owner.
      act(() => {
        api.handleScrollToBottomClick();
      });
      expect(viewport.scrollTop).toBe(6_908);
      flushRafToEmpty();

      clock = 1_100; // post-ordinary but still inside the old absolute record
      viewport.scrollTop = 300;
      const cancellationsBeforeUnpin = cancelledHandles.length;
      act(() => {
        api.notifyUserScrollIntent(-1);
        api.cancelFramePipeline();
      });
      expect(cancelledHandles.length).toBeGreaterThan(cancellationsBeforeUnpin);

      setContentHeight(viewport, 7_000);
      act(() => {
        api.notifyContentResize();
      });
      flushRafToEmpty();
      expect(viewport.scrollTop).toBe(300);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("expires an acknowledged dormant owner before genuine upward takeover", () => {
    let clock = 0;
    const nowSpy = vi.spyOn(performance, "now").mockImplementation(() => clock);
    try {
      const handle = renderHarness();
      const { api, viewport } = handle.current;
      setContentHeight(viewport, 5_552);
      viewport.scrollTop = 425;
      act(() => {
        api.setPinned(false);
        api.startAboveChangeCompensation(
          { rowCount: 5, scrollHeight: 5_552, scrollTop: 425 },
          false,
        );
      });
      setContentHeight(viewport, 6_908);
      flushRafToEmpty();
      expect(viewport.scrollTop).toBe(1_781);

      // Glue ended before the ordinary deadline, leaving the anchor dormant for
      // possible growth. Genuine input after its absolute record must clear it
      // before onViewportScroll can rearm glue or a later resize can revive it.
      clock = 3_100;
      viewport.scrollTop = 200;
      const cancellationsBeforeTakeover = cancelledHandles.length;
      act(() => {
        api.notifyUserScrollIntent(-1);
        api.cancelFramePipeline();
        api.onViewportScroll(viewport);
      });
      expect(cancelledHandles.length).toBeGreaterThan(cancellationsBeforeTakeover);
      expect(rafQueue).toEqual([]);

      setContentHeight(viewport, 7_000);
      act(() => {
        api.notifyContentResize();
      });
      flushRafToEmpty();
      expect(viewport.scrollTop).toBe(200);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("releases at the absolute ceiling instead of retrying silent erosion indefinitely", () => {
    let clock = 0;
    const nowSpy = vi.spyOn(performance, "now").mockImplementation(() => clock);
    try {
      const handle = renderHarness();
      const { api, viewport } = handle.current;
      setContentHeight(viewport, 5_552);
      viewport.scrollTop = 425;
      act(() => {
        api.setPinned(false);
        api.startAboveChangeCompensation(
          { rowCount: 5, scrollHeight: 5_552, scrollTop: 425 },
          false,
        );
      });
      setContentHeight(viewport, 6_908);
      flushRafToEmpty();
      expect(viewport.scrollTop).toBe(1_781);

      // The lifecycle's three-second ceiling wins even if its final correction
      // is silently overwritten. The scheduler may consume the already-owed
      // verifier, but must not start an unbounded position-only retry loop.
      clock = 3_100;
      viewport.scrollTop = 0;
      act(() => {
        api.notifyContentResize();
      });
      expect(viewport.scrollTop).toBe(1_781);
      viewport.scrollTop = 0;
      flushRafToEmpty();

      expect(handle.current.api.isPinnedToBottom).toBe(false);
      expect(rafQueue).toEqual([]);
      expect(viewport.scrollTop).toBe(0);
    } finally {
      nowSpy.mockRestore();
    }
  });
});
