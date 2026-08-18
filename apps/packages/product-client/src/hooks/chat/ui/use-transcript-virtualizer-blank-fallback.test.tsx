/* @vitest-environment jsdom */

import { useRef } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTranscriptVirtualizerBlankFallback } from "./use-transcript-virtualizer-blank-fallback";
import {
  resetRendererDiagnosticsSinkForTest,
  setRendererDiagnosticsSink,
} from "#product/lib/infra/diagnostics/renderer-diagnostics-port";

let frames: FrameRequestCallback[];

beforeEach(() => {
  frames = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  resetRendererDiagnosticsSinkForTest();
});

function flushFrame() {
  const callback = frames.shift();
  callback?.(0);
}

function Harness({
  firstVirtualItem,
  lastVirtualItem,
  onFallback,
  prependSettleUntil = 0,
}: {
  firstVirtualItem: { index: number; start: number; end: number } | null;
  lastVirtualItem: { index: number; start: number; end: number } | null;
  onFallback: (reason: string) => void;
  prependSettleUntil?: number;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastBlankReportSignatureRef = useRef<string | null>(null);
  const prependSettleUntilRef = useRef(prependSettleUntil);
  useTranscriptVirtualizerBlankFallback({
    activeSessionId: "session-1",
    bottomSpacerHeight: 0,
    firstVirtualItem,
    lastVirtualItem,
    lastBlankReportSignatureRef,
    onFallback,
    prependSettleUntilRef,
    renderableRowCount: 100,
    rowCount: 100,
    scrollRef,
    selectedWorkspaceId: "workspace-1",
    topSpacerHeight: 0,
    totalContentHeight: 10_000,
    virtualItemCount: firstVirtualItem && lastVirtualItem ? 2 : 0,
  });
  return (
    <div ref={scrollRef} data-testid="viewport">
      <div data-transcript-virtual-row="true" />
    </div>
  );
}

function setViewportMetrics(viewport: HTMLDivElement, scrollTop: number) {
  Object.defineProperty(viewport, "clientHeight", { value: 400, configurable: true });
  Object.defineProperty(viewport, "scrollHeight", { value: 10_000, configurable: true });
  viewport.scrollTop = scrollTop;
}

describe("useTranscriptVirtualizerBlankFallback", () => {
  it("does no rectangle measurement for a healthy logical virtual range", () => {
    const onFallback = vi.fn();
    const rectangleRead = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect");
    const rendered = render(
      <Harness
        firstVirtualItem={{ index: 4, start: 350, end: 500 }}
        lastVirtualItem={{ index: 8, start: 900, end: 1_050 }}
        onFallback={onFallback}
      />,
    );
    setViewportMetrics(rendered.getByTestId("viewport") as HTMLDivElement, 400);

    act(flushFrame);

    expect(rectangleRead).not.toHaveBeenCalled();
    expect(onFallback).not.toHaveBeenCalled();
  });

  it("requires two DOM-confirmed blank frames before falling back", () => {
    const onFallback = vi.fn();
    const rendered = render(
      <Harness
        firstVirtualItem={{ index: 0, start: 0, end: 100 }}
        lastVirtualItem={{ index: 1, start: 100, end: 200 }}
        onFallback={onFallback}
      />,
    );
    const viewport = rendered.getByTestId("viewport") as HTMLDivElement;
    setViewportMetrics(viewport, 2_000);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
      const top = this === viewport ? 0 : 1_000;
      const bottom = this === viewport ? 400 : 1_100;
      return { top, bottom } as DOMRect;
    });

    act(flushFrame);
    expect(onFallback).not.toHaveBeenCalled();
    expect(frames).toHaveLength(1);

    act(flushFrame);
    expect(onFallback).not.toHaveBeenCalled();
    expect(frames).toHaveLength(1);

    act(flushFrame);
    expect(onFallback).toHaveBeenCalledWith("blank_viewport");
  });

  it("suppresses the blank fallback while an older-history prepend is still settling", () => {
    // Same DOM-confirmed blank condition that falls back in the test above, but
    // with a live prepend-settle grace window: the anchored scrollTop legitimately
    // sits ahead of the still estimate-coordinate mounted range while the freshly
    // prepended rows measure in, so the remount (which would reset scrollTop to 0)
    // must be held off until the window lapses.
    const onFallback = vi.fn();
    const rendered = render(
      <Harness
        firstVirtualItem={{ index: 0, start: 0, end: 100 }}
        lastVirtualItem={{ index: 1, start: 100, end: 200 }}
        onFallback={onFallback}
        prependSettleUntil={performance.now() + 100_000}
      />,
    );
    const viewport = rendered.getByTestId("viewport") as HTMLDivElement;
    setViewportMetrics(viewport, 2_000);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
      const top = this === viewport ? 0 : 1_000;
      const bottom = this === viewport ? 400 : 1_100;
      return { top, bottom } as DOMRect;
    });

    // Far more frames than the two DOM-confirmations the un-graced path needs.
    for (let i = 0; i < 6; i += 1) {
      act(flushFrame);
    }
    expect(onFallback).not.toHaveBeenCalled();
    // It keeps watching (re-arms each frame) rather than giving up.
    expect(frames.length).toBeGreaterThan(0);
  });

  it("negative control: an already-lapsed prepend grace still falls back on a real blank", () => {
    // Grace deadline in the past == no active prepend settle: the identical blank
    // condition must remount exactly as it does with no grace at all, proving the
    // suppression is scoped to the live settle window and not a blanket disable.
    const onFallback = vi.fn();
    const rendered = render(
      <Harness
        firstVirtualItem={{ index: 0, start: 0, end: 100 }}
        lastVirtualItem={{ index: 1, start: 100, end: 200 }}
        onFallback={onFallback}
        prependSettleUntil={performance.now() - 1}
      />,
    );
    const viewport = rendered.getByTestId("viewport") as HTMLDivElement;
    setViewportMetrics(viewport, 2_000);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
      const top = this === viewport ? 0 : 1_000;
      const bottom = this === viewport ? 400 : 1_100;
      return { top, bottom } as DOMRect;
    });

    act(flushFrame);
    act(flushFrame);
    act(flushFrame);
    expect(onFallback).toHaveBeenCalledWith("blank_viewport");
  });

  // Rung 11 (PRO-187, Q8): the founder ruling requires the blank-fallback
  // diagnostic to reach telemetry beyond dev-only console. isMainThreadMeasurementEnabled()
  // defaults false here (the same as a production build with the debug flag
  // off), so this proves the record is no longer gated behind it.
  it("emits the blank-viewport diagnostic even when main-thread measurement is disabled", () => {
    const emit = vi.fn();
    setRendererDiagnosticsSink({ emit });
    const onFallback = vi.fn();
    const rendered = render(
      <Harness
        firstVirtualItem={{ index: 0, start: 0, end: 100 }}
        lastVirtualItem={{ index: 1, start: 100, end: 200 }}
        onFallback={onFallback}
      />,
    );
    const viewport = rendered.getByTestId("viewport") as HTMLDivElement;
    setViewportMetrics(viewport, 2_000);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
      const top = this === viewport ? 0 : 1_000;
      const bottom = this === viewport ? 400 : 1_100;
      return { top, bottom } as DOMRect;
    });

    act(flushFrame);
    act(flushFrame);
    act(flushFrame);

    expect(onFallback).toHaveBeenCalledWith("blank_viewport");
    expect(emit.mock.calls.map(([input]) => input.name)).toContain(
      "renderer.transcript.virtualizer_blank",
    );
  });

  it("does not fall back when a suspicious blank recovers before DOM confirmation", () => {
    const onFallback = vi.fn();
    const rendered = render(
      <Harness
        firstVirtualItem={{ index: 0, start: 0, end: 100 }}
        lastVirtualItem={{ index: 1, start: 100, end: 200 }}
        onFallback={onFallback}
      />,
    );
    const viewport = rendered.getByTestId("viewport") as HTMLDivElement;
    const row = viewport.querySelector<HTMLElement>("[data-transcript-virtual-row='true']")!;
    setViewportMetrics(viewport, 2_000);
    let rowVisible = false;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
      if (this === viewport) {
        return { top: 0, bottom: 400 } as DOMRect;
      }
      return rowVisible && this === row
        ? { top: 100, bottom: 200 } as DOMRect
        : { top: 1_000, bottom: 1_100 } as DOMRect;
    });

    act(flushFrame);
    act(flushFrame);
    rowVisible = true;
    act(flushFrame);

    expect(onFallback).not.toHaveBeenCalled();
    expect(frames).toHaveLength(0);
  });
});
