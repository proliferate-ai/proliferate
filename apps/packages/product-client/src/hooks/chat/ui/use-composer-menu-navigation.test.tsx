// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useComposerMenuNavigation } from "#product/hooks/chat/ui/use-composer-menu-navigation";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useComposerMenuNavigation", () => {
  it("scrolls a later keyboard-highlighted row into the nearest visible edge", () => {
    const scrollIntoView = vi.fn();
    const laterRow = document.createElement("button");
    Object.defineProperty(laterRow, "scrollIntoView", { value: scrollIntoView });
    const { result } = renderHook(() => useComposerMenuNavigation({
      open: true,
      query: "a",
      itemCount: 14,
    }));

    act(() => {
      result.current.setRowRef(13, laterRow);
      result.current.moveHighlight(13);
    });

    expect(result.current.highlightedIndex).toBe(13);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
    expect(result.current.activeDescendantId).toBe(result.current.getRowId(13));
  });
});
