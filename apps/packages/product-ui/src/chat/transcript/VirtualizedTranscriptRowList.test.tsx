/* @vitest-environment jsdom */

import { createRef } from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TranscriptVirtualRow } from "@proliferate/product-domain/chats/transcript/transcript-virtual-rows";
import { VirtualizedTranscriptRowList } from "./VirtualizedTranscriptRowList";

const ROWS: TranscriptVirtualRow[] = [
  { kind: "pending_prompt", key: "pending-prompt:session-1" },
];

beforeEach(() => {
  class TestResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal("ResizeObserver", TestResizeObserver);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function makeProps() {
  return {
    rows: ROWS,
    selectionRootRef: createRef<HTMLDivElement>(),
    hasOlderHistory: false,
    isLoadingOlderHistory: false,
    olderHistoryCursor: null,
    bottomInsetPx: 0,
    selectedWorkspaceId: "workspace-1",
    activeSessionId: "session-1",
    isSessionBusy: false,
    pendingPromptText: null,
    onLoadOlderHistory: vi.fn(),
    onScrollSample: vi.fn(),
    renderRow: (row: TranscriptVirtualRow) => <div>{row.key}</div>,
    onFallback: vi.fn(),
    virtualizationMode: "on" as const,
  };
}

function getViewport(container: HTMLElement): HTMLDivElement {
  const viewport = container.querySelector<HTMLDivElement>(".scrollbar-none");
  expect(viewport).toBeTruthy();
  return viewport!;
}

describe("VirtualizedTranscriptRowList", () => {
  // jsdom does no layout, so the tanstack virtualizer surfaces no virtual items
  // here; these are wiring smoke tests, not layout/measurement tests.
  it("mounts and starts pinned (scroll-to-bottom affordance hidden)", () => {
    const { container } = render(<VirtualizedTranscriptRowList {...makeProps()} />);
    const button = container.querySelector('[aria-label="Scroll to bottom"]');
    expect(button).toBeTruthy();
    expect(button?.getAttribute("aria-hidden")).toBe("true");
  });

  it("reveals the scroll-to-bottom affordance after a user wheels up", () => {
    const { container } = render(<VirtualizedTranscriptRowList {...makeProps()} />);
    const viewport = getViewport(container);
    Object.defineProperty(viewport, "scrollHeight", { value: 2000, configurable: true });
    Object.defineProperty(viewport, "clientHeight", { value: 300, configurable: true });

    act(() => {
      fireEvent.wheel(viewport, { deltaY: -80 });
    });

    const button = container.querySelector('[aria-label="Scroll to bottom"]');
    expect(button?.getAttribute("aria-hidden")).toBe("false");
  });

  it("adds an overlay spacer without changing the current scroll position", () => {
    const props = makeProps();
    const { container, rerender } = render(
      <VirtualizedTranscriptRowList {...props} />,
    );
    const viewport = getViewport(container);
    Object.defineProperty(viewport, "scrollHeight", { value: 1_000, configurable: true });
    viewport.scrollTop = 600;

    rerender(
      <VirtualizedTranscriptRowList
        {...props}
        bottomInsetPx={160}
        nonDisplacingBottomInsetPx={160}
      />,
    );

    expect(viewport.scrollTop).toBe(600);
    expect(
      container.querySelector<HTMLElement>("[data-transcript-bottom-overlay-inset]")?.style.height,
    ).toBe("160px");
    const transcript = container.querySelector<HTMLElement>("[data-transcript-virtualization-mode='virtual']");
    expect(transcript?.className).toContain("mt-auto");
    expect(transcript?.parentElement?.className).toContain("relative flex min-h-full flex-col");
    expect(
      container.querySelector<HTMLElement>("[data-transcript-bottom-overlay-inset]")?.className,
    ).toContain("absolute inset-x-0 top-full");
  });
});
