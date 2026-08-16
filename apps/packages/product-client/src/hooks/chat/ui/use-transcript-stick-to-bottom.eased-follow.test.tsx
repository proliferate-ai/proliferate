/* @vitest-environment jsdom */

import { useRef } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TRANSCRIPT_EASED_FOLLOW_STORAGE_KEY } from "#product/domain/chats/transcript/transcript-eased-follow-config";
import { TRANSCRIPT_EASED_FOLLOW_RATE } from "#product/hooks/chat/ui/transcript-eased-follow";
import {
  useTranscriptStickToBottom,
  type TranscriptStickToBottom,
} from "./use-transcript-stick-to-bottom";

/**
 * PRO-168 (rung 12, Q16): the flag-gated eased-follow writer. All other
 * use-transcript-stick-to-bottom*.test.tsx files run with the flag at its
 * default (off, no key set), proving the instant path is byte-identical to
 * before this rung. This file is the ONLY one that turns the flag on, so it
 * proves the eased writer's own behavior: partial per-frame catch-up under
 * pinned growth, converging to the same target the instant writer reaches.
 */

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
  window.localStorage.setItem(TRANSCRIPT_EASED_FOLLOW_STORAGE_KEY, "on");
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.localStorage.removeItem(TRANSCRIPT_EASED_FOLLOW_STORAGE_KEY);
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

describe("useTranscriptStickToBottom eased-follow writer (PRO-168, rung 12, flag on)", () => {
  it("steps toward the target instead of snapping instantly on the first growth frame", () => {
    const handle = renderHarness();
    const { viewport } = handle.current;
    setMetrics(viewport, { scrollHeight: 1_000, clientHeight: 300, scrollTop: 700 });

    act(() => {
      handle.current.api.notifyContentResize();
    });

    // Target (hard bottom) is 700; starting already there, so no motion is
    // needed yet. Grow the content and resize again to create real distance.
    setMetrics(viewport, { scrollHeight: 2_000, clientHeight: 300, scrollTop: 700 });
    act(() => {
      handle.current.api.notifyContentResize();
    });

    const target = 2_000 - 300; // 1_700
    const expectedFirstStep = 700 + (target - 700) * TRANSCRIPT_EASED_FOLLOW_RATE;
    expect(viewport.scrollTop).toBeCloseTo(expectedFirstStep);
    // A real distance remains: the writer must not have jumped straight there.
    expect(viewport.scrollTop).toBeLessThan(target);
  });

  it("converges to the same hard-bottom target the instant writer would reach", () => {
    const handle = renderHarness();
    const { viewport } = handle.current;
    setMetrics(viewport, { scrollHeight: 1_000, clientHeight: 300, scrollTop: 0 });

    act(() => {
      handle.current.api.notifyContentResize();
    });

    const target = 1_000 - 300; // 700
    // Drive frames until the pipeline goes quiet (motion continuation
    // self-schedules while pending, then stops).
    for (let i = 0; i < 60 && rafCallbacks.some((cb) => cb != null); i += 1) {
      act(() => {
        flushRafRound();
      });
    }

    expect(viewport.scrollTop).toBe(target);
  });

  it("stays pinned (isPinnedToBottom) throughout the eased catch-up", () => {
    const handle = renderHarness();
    const { viewport } = handle.current;
    setMetrics(viewport, { scrollHeight: 5_000, clientHeight: 300, scrollTop: 0 });

    act(() => {
      handle.current.api.notifyContentResize();
    });
    expect(handle.current.api.isPinnedToBottom).toBe(true);

    for (let i = 0; i < 60 && rafCallbacks.some((cb) => cb != null); i += 1) {
      act(() => {
        flushRafRound();
      });
    }
    expect(handle.current.api.isPinnedToBottom).toBe(true);
    expect(viewport.scrollTop).toBe(5_000 - 300);
  });
});
