// @vitest-environment jsdom
import { act, createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useContentSearchStore } from "#product/stores/search/content-search-store";
import { ContentSearchPill } from "#product/components/workspace/search/ContentSearchPill";
import { computeContentSearchPillSideClearance } from "#product/lib/domain/content-search/content-search-placement";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

function renderPill(props?: { rightPanelOpen?: boolean; rightPanelWidth?: number }) {
  return render(
    createElement(ContentSearchPill, {
      rightPanelOpen: props?.rightPanelOpen ?? false,
      rightPanelWidth: props?.rightPanelWidth ?? 0,
    }),
  );
}

function overlayStyle(): CSSStyleDeclaration {
  const overlay = document.querySelector("[data-content-search-overlay]");
  if (!overlay || !(overlay instanceof HTMLElement)) {
    throw new Error("Expected a rendered [data-content-search-overlay] element.");
  }
  return overlay.style;
}

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
    renderPill();

    expect(screen.queryByPlaceholderText("Search chat…")).toBeNull();
  });

  it("renders the file overlay without the chat/diff scope toggle", () => {
    useContentSearchStore.setState({ open: true, surface: "file" });

    renderPill();

    expect(screen.getByPlaceholderText("Search file…")).toBeTruthy();
    expect(screen.queryByRole("radiogroup", { name: "Search scope" })).toBeNull();
  });

  it("shows the chat/diff toggle once the review surface is available", () => {
    useContentSearchStore.setState({
      open: true,
      surface: "chat",
      surfaceAvailability: { file: false, review: true },
    });

    renderPill();

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

    renderPill();

    expect(screen.getByPlaceholderText("Search changes…")).toBeTruthy();
    expect(screen.getByLabelText("Find in changes")).toBeTruthy();
  });

  it("restores the exact origin element on Escape when it is still connected", () => {
    const button = document.createElement("button");
    document.body.append(button);
    button.focus();
    expect(document.activeElement).toBe(button);

    renderPill();
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

    renderPill();
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

    renderPill();
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

    const { unmount } = renderPill();
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

  it("places the file surface pill 90px from the shell top and 16px from the content edge", () => {
    useContentSearchStore.setState({ open: true, surface: "file" });

    renderPill({ rightPanelOpen: true, rightPanelWidth: 420 });

    const style = overlayStyle();
    expect(style.top).toBe("90px");
    expect(style.right).toBe("16px");
  });

  it("places the review surface pill at the same 90px/16px geometry as file", () => {
    useContentSearchStore.setState({
      open: true,
      surface: "review",
      surfaceAvailability: { file: false, review: true },
    });

    renderPill({ rightPanelOpen: true, rightPanelWidth: 420 });

    const style = overlayStyle();
    expect(style.top).toBe("90px");
    expect(style.right).toBe("16px");
  });

  it("keeps file/review placement unchanged whether or not the file-tree dock is open (dock lives left of the content region, never inside it)", () => {
    useContentSearchStore.setState({ open: true, surface: "file" });
    const { unmount } = renderPill({ rightPanelOpen: true, rightPanelWidth: 900 });
    expect(overlayStyle().right).toBe("16px");
    unmount();

    useContentSearchStore.setState({ open: true, surface: "file" });
    renderPill({ rightPanelOpen: true, rightPanelWidth: 380 });
    expect(overlayStyle().right).toBe("16px");
  });

  it("places the chat surface pill 8px below the 46px strip, inset from the effective right rail", () => {
    useContentSearchStore.setState({ open: true, surface: "chat" });

    renderPill({ rightPanelOpen: true, rightPanelWidth: 420 });

    const style = overlayStyle();
    expect(style.top).toBe("54px");
    expect(style.right).toBe("436px");
  });

  it("insets the chat pill only 16px when the right rail is closed", () => {
    useContentSearchStore.setState({ open: true, surface: "chat" });

    renderPill({ rightPanelOpen: false, rightPanelWidth: 420 });

    expect(overlayStyle().right).toBe("16px");
  });

  it("at the 380px right-panel content floor, keeps the ~340px pill right-aligned with at least 16px clearance", () => {
    useContentSearchStore.setState({ open: true, surface: "file" });

    renderPill({ rightPanelOpen: true, rightPanelWidth: 380 });

    const overlay = document.querySelector("[data-content-search-overlay]");
    const pill = overlay?.querySelector(":scope > div");
    expect(pill).toBeTruthy();
    expect(computeContentSearchPillSideClearance(380, 340, 16)).toBeGreaterThanOrEqual(16);
    expect(overlayStyle().right).toBe("16px");
  });
});
