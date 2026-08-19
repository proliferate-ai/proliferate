/* @vitest-environment jsdom */

import { createRef } from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TranscriptVirtualRow } from "#product/domain/chats/transcript/transcript-virtual-rows";
import { VirtualizedTranscriptRowList } from "./VirtualizedTranscriptRowList";

// Sibling of VirtualizedTranscriptRowList.test.tsx: the host's own test file is
// already near the 600-line cap, and this is one self-contained concern — the
// absolute release ceiling on a pending prepend anchor.

const ROWS: TranscriptVirtualRow[] = [
  { kind: "pending_prompt", key: "pending-prompt:session-1" },
];

const OLDER_ROWS: TranscriptVirtualRow[] = [
  { kind: "pending_prompt", key: "pending-prompt:session-1-older" },
  ...ROWS,
];

beforeEach(() => {
  class TestResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal("ResizeObserver", TestResizeObserver);
  vi.useFakeTimers();
});

afterEach(() => {
  // Unmount while the timers are still faked, then drop whatever the
  // virtualizer's debounced notify scheduled on the way out: switching back to
  // real timers first would let that callback fire after teardown and dispatch
  // into a torn-down jsdom window.
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function makeProps() {
  return {
    rows: ROWS,
    selectionRootRef: createRef<HTMLDivElement>(),
    hasOlderHistory: true,
    isLoadingOlderHistory: false,
    olderHistoryCursor: 1 as number | null,
    bottomInsetPx: 0,
    selectedWorkspaceId: "workspace-1",
    activeSessionId: "session-1",
    isSessionBusy: false,
    lastPromptSubmittedAtMs: null,
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

function armAtTop(container: HTMLElement, props: ReturnType<typeof makeProps>) {
  const viewport = getViewport(container);
  Object.defineProperty(viewport, "clientHeight", { value: 400, configurable: true });
  Object.defineProperty(viewport, "scrollHeight", { value: 5_552, configurable: true });
  viewport.scrollTop = 464;
  act(() => {
    fireEvent.scroll(viewport);
  });
  expect(props.onLoadOlderHistory).toHaveBeenCalledTimes(1);
  return viewport;
}

describe("VirtualizedTranscriptRowList prepend-anchor release ceiling", () => {
  // The leak this ceiling exists for: use-session-history-hydration's
  // runHydration has pre-await synchronous returns (superseded request, missing
  // slot), so the request's loading true->false pair can coalesce into a single
  // React 18 commit that the release effect never observes as loading. Rows and
  // cursor are unchanged too, so neither of the other two release proofs can
  // ever arrive — and because maybeLoadOlderHistory only requests while
  // pendingPrependAnchorRef is null, older-history loading is wedged for the
  // rest of the mount. Negative control: drop the
  // `now - armedAt > PREPEND_ANCHOR_IN_FLIGHT_MAX_MS` disjunct and the final
  // expectation fails with 0 calls.
  it("releases an anchor whose loading window was never observable once the ceiling elapses", () => {
    const props = makeProps();
    const { container, rerender } = render(<VirtualizedTranscriptRowList {...props} />);
    const viewport = armAtTop(container, props);

    // The request resolves invisibly: loading never toggles in an observable
    // commit, rows never grow, the cursor never moves.
    act(() => {
      vi.advanceTimersByTime(3_001);
    });

    // An unrelated commit (the real parent passes an inline onLoadOlderHistory,
    // so any parent render produces a fresh identity) re-runs the release
    // effect, which must now clear the leaked anchor on the ceiling alone.
    const nextOnLoadOlderHistory = vi.fn();
    act(() => {
      rerender(
        <VirtualizedTranscriptRowList
          {...props}
          onLoadOlderHistory={nextOnLoadOlderHistory}
        />,
      );
    });

    // Leave and re-cross the top threshold so the per-cursor request guard is
    // reset and the pending-anchor gate is the only thing left under test.
    viewport.scrollTop = 5_000;
    act(() => {
      fireEvent.scroll(viewport);
    });
    viewport.scrollTop = 464;
    act(() => {
      fireEvent.scroll(viewport);
    });

    expect(nextOnLoadOlderHistory).toHaveBeenCalledTimes(1);
  });

  // The ceiling must not preempt a genuinely slow prepend: below the bound the
  // anchor survives unrelated commits, and once the request's loading window is
  // observed the effect early-returns regardless of elapsed time, so the answer
  // still lands compensated.
  it("keeps a genuinely in-flight anchor through the pre-ceiling window and past it while loading", () => {
    const props = makeProps();
    const { container, rerender } = render(<VirtualizedTranscriptRowList {...props} />);
    const viewport = armAtTop(container, props);

    // Well inside the ceiling: an unrelated commit must not release.
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    act(() => {
      rerender(
        <VirtualizedTranscriptRowList {...props} onLoadOlderHistory={vi.fn()} />,
      );
    });

    // The loading window opens observably and the request stays slow past the
    // ceiling; a loading commit can never release.
    act(() => {
      rerender(<VirtualizedTranscriptRowList {...props} isLoadingOlderHistory={true} />);
    });
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    act(() => {
      rerender(
        <VirtualizedTranscriptRowList
          {...props}
          isLoadingOlderHistory={true}
          onLoadOlderHistory={vi.fn()}
        />,
      );
    });

    // The answer commits: the anchor is still seated, so the prepend is
    // compensated instead of stranding the reader.
    Object.defineProperty(viewport, "scrollHeight", { value: 6_908, configurable: true });
    act(() => {
      rerender(
        <VirtualizedTranscriptRowList
          {...props}
          isLoadingOlderHistory={false}
          rows={OLDER_ROWS}
        />,
      );
    });

    expect(viewport.scrollTop).toBe(464 + (6_908 - 5_552));
  });
});
