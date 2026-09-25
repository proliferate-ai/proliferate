/* @vitest-environment jsdom */

import { createRef } from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TranscriptVirtualRow } from "#product/domain/chats/transcript/transcript-virtual-rows";
import { VirtualTranscriptRowList } from "./VirtualTranscriptRowList";

vi.mock("./VirtualizedTranscriptRowList", () => ({
  VirtualizedTranscriptRowList: ({ onFallback }: { onFallback: (reason: string) => void }) => (
    <button type="button" data-testid="virtual" onClick={() => onFallback("blank_viewport")}>
      virtual
    </button>
  ),
}));

vi.mock("./FullTranscriptRowList", () => ({
  FullTranscriptRowList: ({
    fallbackReason,
    rows,
  }: {
    fallbackReason: string | null;
    rows: TranscriptVirtualRow[];
  }) => (
    <div data-testid="full" data-fallback-reason={fallbackReason ?? "disabled"}>
      {rows.length}
    </div>
  ),
}));

const ROWS: TranscriptVirtualRow[] = Array.from({ length: 80 }, (_, index) => ({
  kind: "pending_prompt",
  key: `pending-prompt:${index}`,
}));

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
    lastPromptSubmittedAtMs: null,
    onLoadOlderHistory: vi.fn(),
    onScrollSample: vi.fn(),
    renderRow: (row: TranscriptVirtualRow) => <div>{row.key}</div>,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("VirtualTranscriptRowList", () => {
  it("retries one transient blank fallback without permanently latching a long transcript full-DOM", () => {
    const rendered = render(<VirtualTranscriptRowList {...makeProps()} />);

    fireEvent.click(rendered.getByTestId("virtual"));
    expect(rendered.getByTestId("full").getAttribute("data-fallback-reason"))
      .toBe("blank_viewport");

    act(() => vi.runAllTimers());
    expect(rendered.getByTestId("virtual")).toBeTruthy();

    fireEvent.click(rendered.getByTestId("virtual"));
    expect(rendered.getByTestId("full").getAttribute("data-fallback-reason"))
      .toBe("blank_viewport");

    act(() => vi.runAllTimers());
    expect(rendered.getByTestId("full")).toBeTruthy();
  });

  it("resets the bounded retry when session identity changes", () => {
    const props = makeProps();
    const rendered = render(<VirtualTranscriptRowList {...props} />);

    fireEvent.click(rendered.getByTestId("virtual"));
    act(() => vi.runAllTimers());
    fireEvent.click(rendered.getByTestId("virtual"));
    expect(rendered.getByTestId("full")).toBeTruthy();

    rendered.rerender(
      <VirtualTranscriptRowList
        {...props}
        activeSessionId="session-2"
      />,
    );
    expect(rendered.getByTestId("virtual")).toBeTruthy();

    fireEvent.click(rendered.getByTestId("virtual"));
    expect(rendered.getByTestId("full")).toBeTruthy();
    act(() => vi.runAllTimers());
    expect(rendered.getByTestId("virtual")).toBeTruthy();
  });

  it("keeps the explicit full-render diagnostic mode stable", () => {
    window.localStorage.setItem("proliferate:transcriptVirtualization", "off");

    const rendered = render(<VirtualTranscriptRowList {...makeProps()} />);
    expect(rendered.getByTestId("full").getAttribute("data-fallback-reason"))
      .toBe("disabled");

    act(() => vi.runAllTimers());
    expect(rendered.getByTestId("full")).toBeTruthy();
  });
});
