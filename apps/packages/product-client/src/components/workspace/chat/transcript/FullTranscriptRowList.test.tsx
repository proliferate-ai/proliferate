/* @vitest-environment jsdom */

import { createRef, useState } from "react";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TranscriptVirtualRow } from "#product/domain/chats/transcript/transcript-virtual-rows";
import { WorkspaceCreationReceiptView } from "./WorkspaceCreationReceipt";
import { FullTranscriptRowList } from "./FullTranscriptRowList";
import type { WorkspaceCreationReceiptPresentation } from "#product/lib/domain/workspaces/creation/creation-receipt";

const ROWS: TranscriptVirtualRow[] = [
  {
    kind: "pending_prompt",
    key: "pending-prompt:session-1",
  },
];

const RECEIPT_PRESENTATION: WorkspaceCreationReceiptPresentation = {
  line: "Worktree created",
  busyLabel: null,
  showSpinner: false,
  logLines: [{ tone: "default", text: "Created at /workspace/feature" }],
  defaultExpanded: false,
  showRerun: true,
  rerunDisabled: false,
  rerunLabel: "Rerun setup",
  showCreationRetry: false,
};

function ExpandableReceipt() {
  const [expanded, setExpanded] = useState(false);
  return (
    <WorkspaceCreationReceiptView
      presentation={RECEIPT_PRESENTATION}
      expanded={expanded}
      onToggleExpanded={() => setExpanded((current) => !current)}
      onRerun={() => {}}
    />
  );
}

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
      container.querySelector<HTMLElement>("[data-transcript-bottom-overlay-inset]")?.style.height,
    ).toBe("160px");
    const transcript = container.querySelector<HTMLElement>("[data-transcript-virtualization-mode='full']");
    expect(transcript?.className ?? "").not.toContain("mt-auto");
    expect(transcript?.parentElement?.className).toContain("relative flex min-h-full flex-col");
    expect(
      container.querySelector<HTMLElement>("[data-transcript-bottom-overlay-inset]")?.className,
    ).toContain("absolute inset-x-0 top-full");

    notifyResize();
    expect(viewport.scrollTop).toBe(840);
  });

  it("reveals a receipt above a growing composer through transcript scroll accounting", () => {
    const onScrollSample = vi.fn();
    const props = {
      ...makeProps(vi.fn(), 50),
      bottomInsetPx: 96,
      nonDisplacingBottomInsetPx: 96,
      onScrollSample,
      renderRow: () => <ExpandableReceipt />,
    };
    const rendered = render(<FullTranscriptRowList {...props} />);
    const viewport = getViewport(rendered.container);
    Object.defineProperties(viewport, {
      clientHeight: { configurable: true, value: 480 },
      scrollHeight: { configurable: true, value: 1_000 },
    });
    viewport.scrollTop = 100;
    viewport.scrollLeft = 0;
    viewport.getBoundingClientRect = () => makeRect(0, 0, 320, 480);

    rendered.rerender(
      <FullTranscriptRowList
        {...props}
        bottomInsetPx={156}
        nonDisplacingBottomInsetPx={156}
      />,
    );
    const receipt = rendered.container.querySelector<HTMLElement>(
      "[data-workspace-creation-receipt]",
    );
    expect(receipt).toBeTruthy();
    receipt!.getBoundingClientRect = () => makeRect(
      12,
      560 - viewport.scrollTop,
      296,
      receipt?.querySelector("[aria-expanded='true']") ? 180 : 40,
    );
    const fallbackReveal = vi.fn();
    receipt!.scrollIntoView = fallbackReveal;

    const frames: FrameRequestCallback[] = [];
    vi.mocked(window.requestAnimationFrame).mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    fireEvent.click(rendered.getByRole("button", { name: /Worktree created/ }));
    act(() => {
      frames.shift()?.(0);
    });

    expect(viewport.scrollTop).toBe(416);
    expect(receipt!.getBoundingClientRect().bottom).toBe(324);
    expect(viewport.scrollLeft).toBe(0);
    expect(
      rendered.container.querySelector<HTMLElement>(
        "[data-transcript-bottom-overlay-inset]",
      )?.style.height,
    ).toBe("156px");
    expect(fallbackReveal).not.toHaveBeenCalled();

    fireEvent.scroll(viewport);
    expect(onScrollSample).toHaveBeenLastCalledWith({ programmatic: true });
  });

  it("top-aligns a short transcript above the structural inset", () => {
    const { container } = render(
      <FullTranscriptRowList
        {...makeProps(vi.fn(), 50)}
        bottomInsetPx={120}
      />,
    );

    const transcript = container.querySelector<HTMLElement>("[data-transcript-virtualization-mode='full']");
    const structuralInset = container.querySelector<HTMLElement>(
      "[data-transcript-bottom-structural-inset]",
    );
    expect(transcript?.className ?? "").not.toContain("mt-auto");
    expect(structuralInset?.style.height).toBe("120px");
    expect(structuralInset?.className).toContain("shrink-0");
  });

  it("floats no control the user cannot press", () => {
    // The turn-stepper pair used to render here with both halves permanently
    // disabled, waiting on behavior that never landed. Guarding its absence
    // keeps the visuals from being re-added ahead of the wiring.
    const { container } = render(<FullTranscriptRowList {...makeProps(vi.fn(), 50)} />);

    expect(container.querySelector("[data-transcript-turn-navigator]")).toBeNull();
    const disabled = container.querySelectorAll("button[disabled]");
    expect(disabled).toHaveLength(0);
  });

  it("uses renderer identity as the safe revision fallback", () => {
    const props = makeProps(vi.fn(), 50);
    const rendered = render(
      <FullTranscriptRowList
        {...props}
        renderRow={() => <div>first renderer</div>}
      />,
    );

    rendered.rerender(
      <FullTranscriptRowList
        {...props}
        renderRow={() => <div>next renderer</div>}
      />,
    );

    expect(rendered.getByText("next renderer")).toBeTruthy();
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

function makeRect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    bottom: top + height,
    height,
    left,
    right: left + width,
    top,
    width,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}
