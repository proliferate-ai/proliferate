// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useContentSearchStore } from "#product/stores/search/content-search-store";
import { ContentSearchPill } from "#product/components/workspace/search/ContentSearchPill";

function resetContentSearchStore() {
  useContentSearchStore.setState({
    open: false,
    query: "",
    surface: "chat",
    activeMatchIndex: 0,
    activeMatchId: null,
    unitsById: {},
    nextUnitOrder: 0,
    surfaceAvailability: { file: false, review: false },
  });
}

describe("ContentSearchPill", () => {
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

  it("renders nothing when search is closed", () => {
    render(createElement(ContentSearchPill));

    expect(screen.queryByPlaceholderText("Search chat…")).toBeNull();
  });

  it("renders the file overlay without the chat/diff scope toggle", () => {
    useContentSearchStore.setState({ open: true, surface: "file" });

    render(createElement(ContentSearchPill));

    expect(screen.getByPlaceholderText("Search file…")).toBeTruthy();
    expect(screen.queryByRole("radiogroup", { name: "Search scope" })).toBeNull();
  });

  it("shows the chat/diff toggle once the review surface is available", () => {
    useContentSearchStore.setState({
      open: true,
      surface: "chat",
      surfaceAvailability: { file: false, review: true },
    });

    render(createElement(ContentSearchPill));

    expect(screen.getByRole("radiogroup", { name: "Search scope" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Chat" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Diff" })).toBeTruthy();
  });

  it("uses the review placeholder and aria label when review is the active surface", () => {
    useContentSearchStore.setState({
      open: true,
      surface: "review",
      surfaceAvailability: { file: false, review: true },
    });

    render(createElement(ContentSearchPill));

    expect(screen.getByPlaceholderText("Search changes…")).toBeTruthy();
    expect(screen.getByLabelText("Find in changes")).toBeTruthy();
  });
});
