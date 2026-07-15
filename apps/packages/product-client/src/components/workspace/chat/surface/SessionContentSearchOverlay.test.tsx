// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useContentSearchStore } from "#product/stores/search/content-search-store";
import { SessionContentSearchOverlay } from "#product/components/workspace/chat/surface/SessionContentSearchOverlay";

function resetContentSearchStore() {
  useContentSearchStore.setState({
    open: false,
    query: "",
    surface: "chat",
    activeMatchIndex: 0,
    activeMatchId: null,
    unitsById: {},
    nextUnitOrder: 0,
  });
}

describe("SessionContentSearchOverlay", () => {
  beforeEach(() => {
    resetContentSearchStore();
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders the file overlay without chat or diff scope controls", () => {
    useContentSearchStore.setState({
      open: true,
      surface: "file",
    });

    render(
      createElement(SessionContentSearchOverlay, {
        enabled: true,
        surface: "file",
      }),
    );

    expect(screen.getByPlaceholderText("Search file…")).toBeTruthy();
    expect(screen.queryByLabelText("Search chat")).toBeNull();
    expect(screen.queryByLabelText("Search diffs")).toBeNull();
  });
});
