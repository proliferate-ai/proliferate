// @vitest-environment jsdom
import { act, createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useContentSearchStore } from "#product/stores/search/content-search-store";
import { ContentSearchPill } from "#product/components/workspace/search/ContentSearchPill";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

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
    closeSuppressRestoreToken: 0,
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

  it("restores the exact origin element on Escape when it is still connected", () => {
    const button = document.createElement("button");
    document.body.append(button);
    button.focus();
    expect(document.activeElement).toBe(button);

    render(createElement(ContentSearchPill));
    act(() => {
      useContentSearchStore.getState().openSearch("chat");
    });

    fireEvent.keyDown(screen.getByPlaceholderText("Search chat…"), { key: "Escape" });

    expect(document.activeElement).toBe(button);
    button.remove();
  });

  it("falls back to the owning surface root when the origin element is disconnected", () => {
    const button = document.createElement("button");
    document.body.append(button);
    button.focus();

    const fileFrame = document.createElement("div");
    fileFrame.setAttribute("data-file-viewer-frame", "true");
    fileFrame.tabIndex = -1;
    document.body.append(fileFrame);

    render(createElement(ContentSearchPill));
    act(() => {
      useContentSearchStore.getState().openSearch("file");
    });

    // Origin element disconnects while search is open (e.g. the triggering
    // control unmounted).
    button.remove();

    fireEvent.keyDown(screen.getByPlaceholderText("Search file…"), { key: "Escape" });

    expect(document.activeElement).toBe(fileFrame);
    fileFrame.remove();
  });

  it("does not restore focus for a close suppressed with restoreFocus:false", () => {
    const button = document.createElement("button");
    document.body.append(button);
    button.focus();

    render(createElement(ContentSearchPill));
    act(() => {
      useContentSearchStore.getState().openSearch("chat");
    });

    const decoy = document.createElement("button");
    document.body.append(decoy);
    decoy.focus();

    act(() => {
      useContentSearchStore.getState().closeSearch({ restoreFocus: false });
    });

    expect(document.activeElement).toBe(decoy);
    button.remove();
    decoy.remove();
  });

  it("restores the origin element on unmount", () => {
    const button = document.createElement("button");
    document.body.append(button);
    button.focus();

    const { unmount } = render(createElement(ContentSearchPill));
    act(() => {
      useContentSearchStore.getState().openSearch("chat");
    });

    const decoy = document.createElement("button");
    document.body.append(decoy);
    decoy.focus();

    unmount();

    expect(document.activeElement).toBe(button);
    button.remove();
    decoy.remove();
  });
});
