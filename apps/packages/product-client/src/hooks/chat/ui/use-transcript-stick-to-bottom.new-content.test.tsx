/* @vitest-environment jsdom */

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

interface HarnessHandle {
  api: TranscriptStickToBottom;
  viewport: HTMLDivElement;
}

function renderHarness(): { current: HarnessHandle } {
  const handle: { current: HarnessHandle | null } = { current: null };

  function Harness() {
    const scrollRef = useRef<HTMLDivElement>(null);
    const api = useTranscriptStickToBottom({
      scrollRef,
      onScrollSample: vi.fn(),
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

describe("useTranscriptStickToBottom new-content signal (Q18, rung 9)", () => {
  it("stays false while pinned, even as content grows", () => {
    const handle = renderHarness();
    const { viewport } = handle.current;
    setMetrics(viewport, { scrollHeight: 1_000, clientHeight: 400, scrollTop: 600 });
    act(() => {
      handle.current.api.notifyContentResize();
    });
    setMetrics(viewport, { scrollHeight: 1_400, clientHeight: 400, scrollTop: 1_000 });
    act(() => {
      handle.current.api.notifyContentResize();
    });
    expect(handle.current.api.hasNewContentWhileUnpinned).toBe(false);
  });

  it("raises after unpinning and content growing (streaming mid-read)", () => {
    const handle = renderHarness();
    const { viewport } = handle.current;
    setMetrics(viewport, { scrollHeight: 1_000, clientHeight: 400, scrollTop: 600 });
    act(() => {
      handle.current.api.notifyContentResize();
    });

    // Reader scrolls up, clear of the repin band: unpins.
    userScroll(handle, 200);
    expect(handle.current.api.isPinnedToBottom).toBe(false);
    expect(handle.current.api.hasNewContentWhileUnpinned).toBe(false);

    // Streamed content grows below the fold while unpinned.
    setMetrics(viewport, { scrollHeight: 1_300, clientHeight: 400, scrollTop: 200 });
    act(() => {
      handle.current.api.notifyContentResize();
    });
    expect(handle.current.api.hasNewContentWhileUnpinned).toBe(true);
    // Visibility itself is untouched by this signal: still unpinned.
    expect(handle.current.api.isPinnedToBottom).toBe(false);
  });

  it("clears when the scroll-to-bottom click re-pins", () => {
    const handle = renderHarness();
    const { viewport } = handle.current;
    setMetrics(viewport, { scrollHeight: 1_000, clientHeight: 400, scrollTop: 600 });
    act(() => {
      handle.current.api.notifyContentResize();
    });
    userScroll(handle, 200);
    setMetrics(viewport, { scrollHeight: 1_300, clientHeight: 400, scrollTop: 200 });
    act(() => {
      handle.current.api.notifyContentResize();
    });
    expect(handle.current.api.hasNewContentWhileUnpinned).toBe(true);

    act(() => {
      handle.current.api.handleScrollToBottomClick();
    });
    expect(handle.current.api.hasNewContentWhileUnpinned).toBe(false);
    expect(handle.current.api.isPinnedToBottom).toBe(true);
  });

  it("clears when the reader scrolls back into the repin band on their own", () => {
    const handle = renderHarness();
    const { viewport } = handle.current;
    setMetrics(viewport, { scrollHeight: 1_000, clientHeight: 400, scrollTop: 600 });
    act(() => {
      handle.current.api.notifyContentResize();
    });
    userScroll(handle, 200);
    setMetrics(viewport, { scrollHeight: 1_300, clientHeight: 400, scrollTop: 200 });
    act(() => {
      handle.current.api.notifyContentResize();
    });
    expect(handle.current.api.hasNewContentWhileUnpinned).toBe(true);

    // Reader scrolls down into the 24px repin band unassisted.
    userScroll(handle, 900);
    expect(handle.current.api.isPinnedToBottom).toBe(true);
    expect(handle.current.api.hasNewContentWhileUnpinned).toBe(false);
  });

  it("resetForSession drops the signal (session switch mid-unpin)", () => {
    const handle = renderHarness();
    const { viewport } = handle.current;
    setMetrics(viewport, { scrollHeight: 1_000, clientHeight: 400, scrollTop: 600 });
    act(() => {
      handle.current.api.notifyContentResize();
    });
    userScroll(handle, 200);
    setMetrics(viewport, { scrollHeight: 1_300, clientHeight: 400, scrollTop: 200 });
    act(() => {
      handle.current.api.notifyContentResize();
    });
    expect(handle.current.api.hasNewContentWhileUnpinned).toBe(true);

    act(() => {
      handle.current.api.resetForSession();
    });
    expect(handle.current.api.hasNewContentWhileUnpinned).toBe(false);
  });

  it("a shrink alone (row collapse) while unpinned does not raise the signal", () => {
    const handle = renderHarness();
    const { viewport } = handle.current;
    setMetrics(viewport, { scrollHeight: 1_400, clientHeight: 400, scrollTop: 900 });
    act(() => {
      handle.current.api.notifyContentResize();
    });
    userScroll(handle, 200);
    setMetrics(viewport, { scrollHeight: 1_000, clientHeight: 400, scrollTop: 200 });
    act(() => {
      handle.current.api.notifyContentResize();
    });
    expect(handle.current.api.hasNewContentWhileUnpinned).toBe(false);
  });
});
