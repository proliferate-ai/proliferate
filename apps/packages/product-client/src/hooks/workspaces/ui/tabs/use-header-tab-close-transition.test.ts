/* @vitest-environment jsdom */

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useHeaderTabCloseTransition } from "#product/hooks/workspaces/ui/tabs/use-header-tab-close-transition";
import type { HeaderWorkspaceShellStripRow } from "#product/lib/domain/workspaces/tabs/workspace-header-tabs-view-model-types";

afterEach(() => {
  cleanup();
});

// Only `shellRow.row.tab.id` is read by the hook under test, so the row is
// built as a minimal stand-in rather than a fully-typed view model.
function chatRow(sessionId: string): HeaderWorkspaceShellStripRow {
  return {
    kind: "chat",
    row: { kind: "tab", tab: { id: sessionId } },
    shellKeys: [],
  } as unknown as HeaderWorkspaceShellStripRow;
}

describe("useHeaderTabCloseTransition", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("adds a ghost with the closing tab's frozen geometry, then removes it after the exit duration", () => {
    const shellRows = [chatRow("a"), chatRow("b")];
    const { result } = renderHook(() =>
      useHeaderTabCloseTransition({ shellRows, positions: [0, 100], widths: [100, 120] }));

    act(() => {
      result.current.beginCloseChatTab("a");
    });

    expect(result.current.closingTabs).toEqual([{ id: "a", left: 0, width: 100 }]);

    act(() => {
      vi.advanceTimersByTime(160);
    });

    expect(result.current.closingTabs).toEqual([]);
  });

  it("does nothing for a session id that isn't in the strip's rows", () => {
    const shellRows = [chatRow("a")];
    const { result } = renderHook(() =>
      useHeaderTabCloseTransition({ shellRows, positions: [0], widths: [100] }));

    act(() => {
      result.current.beginCloseChatTab("unknown");
    });

    expect(result.current.closingTabs).toEqual([]);
  });

  it("does nothing for a tab with no measured width yet", () => {
    const shellRows = [chatRow("a")];
    const { result } = renderHook(() =>
      useHeaderTabCloseTransition({ shellRows, positions: [0], widths: [0] }));

    act(() => {
      result.current.beginCloseChatTab("a");
    });

    expect(result.current.closingTabs).toEqual([]);
  });

  /**
   * A double-close is the realistic version of this: the user clicks close,
   * then (before the exit animation finishes) closes the same tab again via a
   * keyboard shortcut or a second stray click on a still-rendered ghost. The
   * hook must not accumulate two ghosts for the same id, nor leave the first
   * timeout armed to delete a ghost the second call already replaced.
   */
  it("de-dupes a same-tab double-close into one ghost and one live timeout", () => {
    const shellRows = [chatRow("a")];
    const { result } = renderHook(() =>
      useHeaderTabCloseTransition({ shellRows, positions: [0], widths: [100] }));

    act(() => {
      result.current.beginCloseChatTab("a");
    });
    act(() => {
      vi.advanceTimersByTime(80);
    });
    act(() => {
      result.current.beginCloseChatTab("a");
    });

    expect(result.current.closingTabs).toEqual([{ id: "a", left: 0, width: 100 }]);

    // The first close's timeout must have been cleared, not merely
    // superseded: advancing only to its original deadline (160ms after the
    // first call, 80ms after the second) must not clear the ghost early.
    act(() => {
      vi.advanceTimersByTime(80);
    });
    expect(result.current.closingTabs).toEqual([{ id: "a", left: 0, width: 100 }]);

    act(() => {
      vi.advanceTimersByTime(80);
    });
    expect(result.current.closingTabs).toEqual([]);
  });

  it("tracks independent ghosts for two different tabs closed together", () => {
    const shellRows = [chatRow("a"), chatRow("b")];
    const { result } = renderHook(() =>
      useHeaderTabCloseTransition({ shellRows, positions: [0, 100], widths: [100, 120] }));

    act(() => {
      result.current.beginCloseChatTab("a");
      result.current.beginCloseChatTab("b");
    });

    expect(result.current.closingTabs).toEqual([
      { id: "a", left: 0, width: 100 },
      { id: "b", left: 100, width: 120 },
    ]);
  });

  it("derives contentWidth from the last tab's trailing edge", () => {
    const shellRows: HeaderWorkspaceShellStripRow[] = [];
    const { result, rerender } = renderHook(
      ({ positions, widths }: { positions: number[]; widths: number[] }) =>
        useHeaderTabCloseTransition({ shellRows, positions, widths }),
      { initialProps: { positions: [0, 100], widths: [100, 120] } },
    );

    expect(result.current.contentWidth).toBe(220);

    rerender({ positions: [], widths: [] });
    expect(result.current.contentWidth).toBe(0);
  });

  it("clears any pending ghost-removal timeout on unmount, so it never fires against unmounted state", () => {
    const shellRows = [chatRow("a")];
    const clearTimeoutSpy = vi.spyOn(window, "clearTimeout");
    const { result, unmount } = renderHook(() =>
      useHeaderTabCloseTransition({ shellRows, positions: [0], widths: [100] }));

    act(() => {
      result.current.beginCloseChatTab("a");
    });
    clearTimeoutSpy.mockClear();

    unmount();

    expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);
    clearTimeoutSpy.mockRestore();
  });
});
