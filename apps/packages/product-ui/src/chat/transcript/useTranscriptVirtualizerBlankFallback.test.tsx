/* @vitest-environment jsdom */

import { useRef } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTranscriptVirtualizerBlankFallback } from "./useTranscriptVirtualizerBlankFallback";

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

function renderHarness(measurementReady: boolean, onFallback: (reason: string) => void) {
  function Harness() {
    const scrollRef = useRef<HTMLDivElement>(null);
    const lastBlankReportSignatureRef = useRef<string | null>(null);
    useTranscriptVirtualizerBlankFallback({
      activeSessionId: "session-1",
      firstVirtualItem: { index: 0 },
      lastVirtualItem: { index: 0 },
      lastBlankReportSignatureRef,
      measurementReady,
      onFallback,
      rowCount: 3,
      scrollRef,
    });
    return (
      <div
        ref={(node) => {
          if (node) {
            // A scrollable viewport with zero rendered rows reads as "blank".
            Object.defineProperty(node, "scrollHeight", { value: 2000, configurable: true });
            Object.defineProperty(node, "clientHeight", { value: 300, configurable: true });
            node.getBoundingClientRect = () =>
              ({ top: 0, bottom: 300, left: 0, right: 0, width: 0, height: 300, x: 0, y: 0, toJSON() {} }) as DOMRect;
            scrollRef.current = node;
          }
        }}
      />
    );
  }
  render(<Harness />);
}

describe("useTranscriptVirtualizerBlankFallback", () => {
  it("does not report blank until a measurement pass has completed", () => {
    const onFallback = vi.fn();
    renderHarness(false, onFallback);
    act(() => {
      flushRafRound();
    });
    expect(onFallback).not.toHaveBeenCalled();
  });

  it("reports blank once measurement is ready and the viewport has no visible rows", () => {
    const onFallback = vi.fn();
    renderHarness(true, onFallback);
    act(() => {
      flushRafRound();
    });
    expect(onFallback).toHaveBeenCalledWith("blank_viewport");
  });
});
