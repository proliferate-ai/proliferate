/* @vitest-environment jsdom */

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useChatDockInset } from "./use-chat-dock-inset";

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

/** Run one round of currently-queued rAF callbacks. */
function flushRafRound() {
  const pending = rafCallbacks;
  rafCallbacks = [];
  for (const cb of pending) {
    cb?.(0);
  }
}

/** jsdom never lays out, so the dock's rect must be stubbed directly. */
function stubDockHeight(el: HTMLElement, height: number) {
  el.getBoundingClientRect = () => ({
    x: 0, y: 0, width: 0, height,
    top: 0, left: 0, right: 0, bottom: height,
    toJSON() {},
  } as DOMRect);
}

/** Captures the ResizeObserver callback so the test can fire it manually. */
function stubCapturingResizeObserver(): () => void {
  const callbacks: ResizeObserverCallback[] = [];
  class CapturingResizeObserver {
    constructor(callback: ResizeObserverCallback) {
      callbacks.push(callback);
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal("ResizeObserver", CapturingResizeObserver);
  const observerStub = {
    observe() {},
    unobserve() {},
    disconnect() {},
  } as unknown as ResizeObserver;
  return () => {
    for (const callback of [...callbacks]) {
      callback([], observerStub);
    }
  };
}

interface HarnessHandle {
  dockHeightPx: number;
}

function renderHarness() {
  const handle: { current: HarnessHandle | null } = { current: null };
  let dockEl: HTMLDivElement | null = null;

  function Harness() {
    const { dockRef, dockHeightPx } = useChatDockInset();
    handle.current = { dockHeightPx };
    return (
      <div
        ref={(node) => {
          dockRef.current = node;
          dockEl = node;
        }}
      />
    );
  }

  render(<Harness />);
  return {
    get current() {
      return handle.current!;
    },
    get dockEl() {
      return dockEl!;
    },
  };
}

// jsdom does no real layout, so these tests only cover the trigger wiring:
// which path (synchronous flush vs. rAF-deferred) the ResizeObserver callback
// takes, not the resulting metrics math.
describe("useChatDockInset", () => {
  it("defers a dock height increase to the rAF-coalesced path", () => {
    const notifyResize = stubCapturingResizeObserver();
    const handle = renderHarness();
    stubDockHeight(handle.dockEl, 200);

    act(() => {
      notifyResize();
    });
    // Growth does not commit until the deferred frame runs.
    expect(handle.current.dockHeightPx).toBe(0);

    act(() => {
      flushRafRound();
    });
    expect(handle.current.dockHeightPx).toBe(200);
  });

  it("applies a dock height decrease synchronously within the observer callback (submit collapse)", () => {
    const notifyResize = stubCapturingResizeObserver();
    const handle = renderHarness();

    // Establish a taller baseline first, via the normal rAF-deferred path.
    stubDockHeight(handle.dockEl, 200);
    act(() => {
      notifyResize();
      flushRafRound();
    });
    expect(handle.current.dockHeightPx).toBe(200);

    // The collapse path must land before the next paint — no rAF flush needed.
    stubDockHeight(handle.dockEl, 80);
    act(() => {
      notifyResize();
    });
    expect(handle.current.dockHeightPx).toBe(80);
    expect(rafCallbacks.filter(Boolean)).toHaveLength(0);
  });
});
