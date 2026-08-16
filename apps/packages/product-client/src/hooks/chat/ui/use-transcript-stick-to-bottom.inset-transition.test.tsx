/* @vitest-environment jsdom */

// Rung 7 / Q6 engine wiring: a DISPLACING (structural) dock-inset change
// (composer growth/collapse, status bar) routes through the consumed-inset
// machine so a shrink's upward clamp is marked non-user (no fight, no wrongful
// overlay consume), a growth simply follows, and an UNPINNED reader is never
// displaced by the change.

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

function renderHarness(onScrollSample = vi.fn(), initialStructuralPx = 120) {
  const handle: { current: HarnessHandle | null } = { current: null };

  function Harness({ structuralPx }: { structuralPx: number }) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const api = useTranscriptStickToBottom({
      scrollRef,
      onScrollSample,
      structuralBottomInsetPx: structuralPx,
      nonDisplacingBottomInsetPx: 0,
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

  const rendered = render(<Harness structuralPx={initialStructuralPx} />);
  return {
    get current() {
      return handle.current!;
    },
    rerenderStructural(structuralPx: number) {
      rendered.rerender(<Harness structuralPx={structuralPx} />);
    },
  };
}

function setMetrics(
  el: HTMLElement,
  m: { scrollHeight: number; clientHeight: number; scrollTop: number },
) {
  Object.defineProperty(el, "scrollHeight", { value: m.scrollHeight, configurable: true });
  Object.defineProperty(el, "clientHeight", { value: m.clientHeight, configurable: true });
  el.scrollTop = m.scrollTop;
}

function dispatchScroll(handle: { current: HarnessHandle }) {
  act(() => {
    handle.current.api.onViewportScroll(handle.current.viewport);
  });
}

describe("useTranscriptStickToBottom displacing-inset transitions", () => {
  it("marks the upward clamp a composer collapse queues so the pinned reader is not fought", () => {
    const onScrollSample = vi.fn();
    const handle = renderHarness(onScrollSample, 120);
    const { viewport } = handle.current;

    // Pinned at the hard bottom of a document whose 120px structural inset is
    // in scrollHeight.
    setMetrics(viewport, { scrollHeight: 1_120, clientHeight: 300, scrollTop: 820 });
    act(() => {
      handle.current.api.scrollToBottom();
    });
    dispatchScroll(handle);
    expect(handle.current.api.isPinnedToBottom).toBe(true);

    // Composer collapses: structural 120 -> 40, scrollHeight shrinks 80, the
    // browser clamps scrollTop upward by 80 to the new hard bottom before the
    // layout effect runs.
    setMetrics(viewport, { scrollHeight: 1_040, clientHeight: 300, scrollTop: 740 });
    handle.rerenderStructural(40);
    dispatchScroll(handle);

    // The clamp is our own write: classified programmatic, pin held.
    expect(handle.current.api.isPinnedToBottom).toBe(true);
    expect(onScrollSample).toHaveBeenLastCalledWith({ programmatic: true });
  });

  it("NEGATIVE CONTROL: a composer GROWTH follows without marking a clamp and without unpinning", () => {
    const onScrollSample = vi.fn();
    const handle = renderHarness(onScrollSample, 40);
    const { viewport } = handle.current;

    setMetrics(viewport, { scrollHeight: 1_040, clientHeight: 300, scrollTop: 740 });
    act(() => {
      handle.current.api.scrollToBottom();
    });
    dispatchScroll(handle);
    expect(handle.current.api.isPinnedToBottom).toBe(true);

    // Composer grows: structural 40 -> 120, scrollHeight grows 80. No clamp is
    // queued (growth, not shrink), so the event is a genuine resize-lag hold,
    // NOT forced programmatic by a marker.
    setMetrics(viewport, { scrollHeight: 1_120, clientHeight: 300, scrollTop: 740 });
    handle.rerenderStructural(120);
    dispatchScroll(handle);

    expect(handle.current.api.isPinnedToBottom).toBe(true);
    expect(onScrollSample).toHaveBeenLastCalledWith({ programmatic: false });

    // The snap follows the taller document to the new hard bottom (no fight).
    act(() => {
      handle.current.api.scrollToBottom();
    });
    expect(viewport.scrollTop).toBe(1_120);
  });

  it("does not displace an UNPINNED reader when the structural inset changes", () => {
    const onScrollSample = vi.fn();
    const handle = renderHarness(onScrollSample, 120);
    const { viewport } = handle.current;

    // Reader scrolls up and unpins.
    setMetrics(viewport, { scrollHeight: 1_120, clientHeight: 300, scrollTop: 820 });
    act(() => {
      handle.current.api.notifyUserScrollIntent(-1);
    });
    setMetrics(viewport, { scrollHeight: 1_120, clientHeight: 300, scrollTop: 200 });
    dispatchScroll(handle);
    expect(handle.current.api.isPinnedToBottom).toBe(false);

    const readingTop = viewport.scrollTop;

    // Composer collapses below the fold. The layout effect must not mark or
    // write while unpinned, so the reading position is untouched.
    setMetrics(viewport, { scrollHeight: 1_040, clientHeight: 300, scrollTop: readingTop });
    handle.rerenderStructural(40);

    expect(viewport.scrollTop).toBe(readingTop);
    expect(handle.current.api.isPinnedToBottom).toBe(false);
  });
});
