// @vitest-environment jsdom
import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearShortcutHandlerRegistryForTests,
  runShortcutHandler,
} from "@/lib/domain/shortcuts/registry";
import { useContentSearchStore } from "@/stores/search/content-search-store";
import { SessionContentSearchOverlay } from "./SessionContentSearchOverlay";

function resetContentSearchStore() {
  useContentSearchStore.setState({
    open: false,
    query: "",
    surface: "chat",
    scope: "diffs",
    activeMatchIndex: 0,
    activeMatchId: null,
    unitsById: {},
    nextUnitOrder: 0,
  });
}

describe("SessionContentSearchOverlay", () => {
  beforeEach(() => {
    resetContentSearchStore();
    clearShortcutHandlerRegistryForTests();
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
  });

  afterEach(() => {
    cleanup();
    clearShortcutHandlerRegistryForTests();
    vi.restoreAllMocks();
  });

  it("routes the find shortcut to the file overlay when focus is in a file viewer", () => {
    render(
      createElement("div", null,
        createElement("div", { "data-focus-zone": "chat" },
          createElement(SessionContentSearchOverlay, {
            enabled: true,
            surface: "chat",
          }),
        ),
        createElement("div", { "data-focus-zone": "right-panel" },
          createElement("div", { "data-file-viewer-frame": true },
            createElement("button", { type: "button" }, "File focus target"),
            createElement(SessionContentSearchOverlay, {
              enabled: true,
              surface: "file",
            }),
          ),
        ),
      ),
    );

    const focusTarget = screen.getByText("File focus target");
    fireEvent.click(focusTarget);
    focusTarget.focus();

    let handled = false;
    act(() => {
      handled = runShortcutHandler("workspace.find-content", { source: "keyboard" });
    });
    expect(handled).toBe(true);
    expect(useContentSearchStore.getState().surface).toBe("file");
    expect(screen.getByPlaceholderText("Search file…")).toBeTruthy();
    expect(screen.queryByLabelText("Search chat")).toBeNull();
    expect(screen.queryByLabelText("Search diffs")).toBeNull();
  });
});
