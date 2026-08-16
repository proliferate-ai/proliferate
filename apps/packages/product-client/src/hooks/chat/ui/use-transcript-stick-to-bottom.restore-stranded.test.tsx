/* @vitest-environment jsdom */

// Founder Ruling 3(a)/(b) (rung 10, PRO-187): rung 6 left open a THEORETICAL
// strand where a saved FR-2 reading position's row never mounts, so the
// restore's coarse index-sum estimate never gets proven against the row's real
// geometry and the frame writer, once the restore deadline lapses, would
// otherwise simply stop touching scrollTop — freezing the reader at whatever
// unverified estimate it last wrote. This file constructs that exact strand
// (a resolver that returns `mounted: false` for the whole restore window) and
// asserts the Ruling 3(b) fallback: give up at the bounded deadline and
// bottom-pin, the same conservative default a vanished saved row already gets.

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

function setMetrics(el: HTMLElement, metrics: { scrollHeight: number; clientHeight: number; scrollTop: number }) {
  Object.defineProperty(el, "scrollHeight", { value: metrics.scrollHeight, configurable: true });
  Object.defineProperty(el, "clientHeight", { value: metrics.clientHeight, configurable: true });
  el.scrollTop = metrics.scrollTop;
}

describe("FR-2 restore stranding (Founder Ruling 3, rung 10)", () => {
  // This IS constructible: nothing in resolveTargetTop's contract prevents a
  // resolver from returning the coarse (`mounted: false`) resolution for the
  // entire restore window — that is exactly what happens whenever the saved
  // row's index sits permanently outside the virtualizer's render window (an
  // overscan/measurement corner case), so the estimate-immune DOM-rect branch
  // in transcript-reading-position-store.ts never runs.
  it("gives up at the deadline and bottom-pins instead of freezing at the unproven coarse estimate", () => {
    const handle = renderHarness();
    const { viewport } = handle.current;
    setMetrics(viewport, { scrollHeight: 2000, clientHeight: 300, scrollTop: 0 });

    let nowMs = 0;
    const nowSpy = vi.spyOn(performance, "now").mockImplementation(() => nowMs);

    act(() => {
      handle.current.api.resetForSession({
        kind: "restore",
        resolveTargetTop: () => ({ top: 900, mounted: false }),
      });
    });
    expect(handle.current.api.isPinnedToBottom).toBe(false);
    expect(viewport.scrollTop).toBe(900);

    // Still within the 500ms restore deadline: the coarse estimate keeps
    // holding, never mounted, not yet given up.
    nowMs = 200;
    act(() => { flushRafRound(); });
    expect(handle.current.api.isPinnedToBottom).toBe(false);
    expect(viewport.scrollTop).toBe(900);

    // Past the deadline, having NEVER mounted: bottom-pin (Ruling 3(b)) rather
    // than freeze at the unproven coarse estimate.
    nowMs = 600;
    act(() => { flushRafRound(); });
    expect(handle.current.api.isPinnedToBottom).toBe(true);
    expect(viewport.scrollTop).toBe(2000);

    nowSpy.mockRestore();
  });

  // Negative control: once the saved row DOES mount even once before the
  // deadline, the strand cannot occur (the estimate-immune path is proven at
  // least once), so the engine must NOT bottom-pin merely because the
  // deadline later lapses. Revert the `everMounted` gate in
  // use-transcript-frame-pipeline-lifecycle.ts (always treat as stranded) and
  // this assertion fails: `isPinnedToBottom` flips true / scrollTop jumps to
  // 2000 even though the row mounted.
  it("does not bottom-pin when the saved row mounted at least once before the deadline", () => {
    const handle = renderHarness();
    const { viewport } = handle.current;
    setMetrics(viewport, { scrollHeight: 2000, clientHeight: 300, scrollTop: 0 });

    let nowMs = 0;
    const nowSpy = vi.spyOn(performance, "now").mockImplementation(() => nowMs);
    let mounted = false;

    act(() => {
      handle.current.api.resetForSession({
        kind: "restore",
        resolveTargetTop: () => ({ top: 900, mounted }),
      });
    });

    nowMs = 200;
    mounted = true;
    act(() => { flushRafRound(); });
    mounted = false;

    nowMs = 600;
    act(() => { flushRafRound(); });
    expect(handle.current.api.isPinnedToBottom).toBe(false);
    expect(viewport.scrollTop).toBe(900);

    nowSpy.mockRestore();
  });
});
