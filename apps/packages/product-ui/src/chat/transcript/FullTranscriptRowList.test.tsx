/* @vitest-environment jsdom */

import { createRef } from "react";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TranscriptVirtualRow } from "@proliferate/product-domain/chats/transcript/transcript-virtual-rows";
import { FullTranscriptRowList } from "./FullTranscriptRowList";

const ROWS: TranscriptVirtualRow[] = [
  {
    kind: "pending_prompt",
    key: "pending-prompt:session-1",
  },
];

beforeEach(() => {
  class TestResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal("ResizeObserver", TestResizeObserver);
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    callback(0);
    return 1;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("FullTranscriptRowList", () => {
  it("continues from a newer older-history cursor while pinned at the top", async () => {
    const onLoadOlderHistory = vi.fn();
    const props = makeProps(onLoadOlderHistory, 50);
    const { container, rerender } = render(<FullTranscriptRowList {...props} />);
    const viewport = getViewport(container);

    await waitFor(() => expect(onLoadOlderHistory).toHaveBeenCalledTimes(1));

    rerender(<FullTranscriptRowList {...makeProps(onLoadOlderHistory, 50, true)} />);
    rerender(<FullTranscriptRowList {...props} />);
    fireEvent.scroll(viewport, { target: { scrollTop: 0 } });
    expect(onLoadOlderHistory).toHaveBeenCalledTimes(1);

    rerender(<FullTranscriptRowList {...makeProps(onLoadOlderHistory, 40)} />);
    await waitFor(() => expect(onLoadOlderHistory).toHaveBeenCalledTimes(2));

    rerender(<FullTranscriptRowList {...makeProps(onLoadOlderHistory, 40, true)} />);
    rerender(<FullTranscriptRowList {...makeProps(onLoadOlderHistory, 40)} />);
    await waitFor(() => expect(onLoadOlderHistory).toHaveBeenCalledTimes(2));
    fireEvent.scroll(viewport, { target: { scrollTop: 600 } });
    fireEvent.scroll(viewport, { target: { scrollTop: 0 } });
    expect(onLoadOlderHistory).toHaveBeenCalledTimes(3);
  });

  it("re-sticks to the bottom when content resizes while pinned", () => {
    const notifyResize = stubCapturingResizeObserver();
    const { container } = render(
      <FullTranscriptRowList {...makeProps(vi.fn(), 50)} />,
    );
    const viewport = getViewport(container);
    Object.defineProperty(viewport, "scrollHeight", {
      value: 500,
      configurable: true,
    });

    notifyResize();

    expect(viewport.scrollTop).toBe(500);
  });

  it("re-sticks synchronously when a row updates without changing row count", () => {
    const props = makeProps(vi.fn(), 50);
    const { container, rerender } = render(<FullTranscriptRowList {...props} />);
    const viewport = getViewport(container);
    Object.defineProperty(viewport, "scrollHeight", {
      value: 700,
      configurable: true,
    });
    viewport.scrollTop = 100;

    rerender(
      <FullTranscriptRowList
        {...props}
        rows={ROWS.map((row) => ({ ...row }))}
      />,
    );

    expect(viewport.scrollTop).toBe(700);
  });

  it("leaves the viewport alone on resize after scrolling away from the bottom", () => {
    const notifyResize = stubCapturingResizeObserver();
    const { container } = render(
      <FullTranscriptRowList {...makeProps(vi.fn(), 50)} />,
    );
    const viewport = getViewport(container);
    Object.defineProperty(viewport, "scrollHeight", {
      value: 1000,
      configurable: true,
    });
    fireEvent.scroll(viewport, { target: { scrollTop: 600 } });

    notifyResize();

    expect(viewport.scrollTop).toBe(600);
  });

  it("adds manual scroll range for composer cards without moving the transcript", () => {
    const notifyResize = stubCapturingResizeObserver();
    const props = makeProps(vi.fn(), 50);
    const { container, rerender } = render(<FullTranscriptRowList {...props} />);
    const viewport = getViewport(container);
    let scrollHeight = 840;
    Object.defineProperty(viewport, "scrollHeight", {
      get: () => scrollHeight,
      configurable: true,
    });
    Object.defineProperty(viewport, "clientHeight", {
      value: 0,
      configurable: true,
    });
    viewport.scrollTop = 840;
    scrollHeight = 1_000;

    rerender(
      <FullTranscriptRowList
        {...props}
        bottomInsetPx={160}
        nonDisplacingBottomInsetPx={160}
      />,
    );

    expect(viewport.scrollTop).toBe(840);
    expect(
      container.querySelector<HTMLElement>("[data-transcript-bottom-inset]")?.style.height,
    ).toBe("160px");

    notifyResize();
    expect(viewport.scrollTop).toBe(840);
  });
});

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

function makeProps(
  onLoadOlderHistory: () => void,
  olderHistoryCursor: number,
  isLoadingOlderHistory = false,
) {
  return {
    rows: ROWS,
    selectionRootRef: createRef<HTMLDivElement>(),
    hasOlderHistory: true,
    isLoadingOlderHistory,
    olderHistoryCursor,
    bottomInsetPx: 0,
    selectedWorkspaceId: "workspace-1",
    activeSessionId: "session-1",
    isSessionBusy: false,
    pendingPromptText: null,
    onLoadOlderHistory,
    onScrollSample: vi.fn(),
    renderRow: (row: TranscriptVirtualRow) => <div>{row.key}</div>,
    fallbackReason: null,
    virtualizationMode: "off" as const,
  };
}

function getViewport(container: HTMLElement): HTMLDivElement {
  const viewport = container.querySelector<HTMLDivElement>(".scrollbar-none");
  expect(viewport).toBeTruthy();
  return viewport!;
}
