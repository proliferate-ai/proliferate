/* @vitest-environment jsdom */

import { createRef } from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TranscriptVirtualRow } from "@/lib/domain/chat/transcript-virtual-rows";
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
  it("does not repeatedly request the same older-history cursor while pinned at the top", () => {
    const onLoadOlderHistory = vi.fn();
    const props = makeProps(onLoadOlderHistory, 50);
    const { container, rerender } = render(<FullTranscriptRowList {...props} />);
    const viewport = getViewport(container);

    fireEvent.scroll(viewport, { target: { scrollTop: 0 } });
    expect(onLoadOlderHistory).toHaveBeenCalledTimes(1);

    rerender(<FullTranscriptRowList {...makeProps(onLoadOlderHistory, 50, true)} />);
    rerender(<FullTranscriptRowList {...props} />);
    fireEvent.scroll(viewport, { target: { scrollTop: 0 } });
    expect(onLoadOlderHistory).toHaveBeenCalledTimes(1);

    rerender(<FullTranscriptRowList {...makeProps(onLoadOlderHistory, 40)} />);
    fireEvent.scroll(viewport, { target: { scrollTop: 0 } });
    expect(onLoadOlderHistory).toHaveBeenCalledTimes(2);

    rerender(<FullTranscriptRowList {...makeProps(onLoadOlderHistory, 40, true)} />);
    rerender(<FullTranscriptRowList {...makeProps(onLoadOlderHistory, 40)} />);
    fireEvent.scroll(viewport, { target: { scrollTop: 600 } });
    fireEvent.scroll(viewport, { target: { scrollTop: 0 } });
    expect(onLoadOlderHistory).toHaveBeenCalledTimes(3);
  });
});

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
