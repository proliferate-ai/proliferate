// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KeyboardShortcutsPane } from "@/components/settings/panes/KeyboardShortcutsPane";

describe("KeyboardShortcutsPane", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders shortcuts in searchable sections with trailing keybindings", () => {
    vi.stubGlobal("navigator", {
      platform: "MacIntel",
      userAgent: "Mac OS X",
    });

    render(<KeyboardShortcutsPane />);

    expect(screen.getByRole("heading", { name: "Keyboard shortcuts" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "App" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Tabs" })).toBeTruthy();
    expect(screen.getByText("Open browser tab")).toBeTruthy();
    const browserRow = screen.getByText("Open browser tab").closest("li");
    if (!(browserRow instanceof HTMLElement)) {
      throw new Error("Expected browser shortcut row");
    }
    expect(within(browserRow).getByText("⌘T").closest("div")?.className).toContain("ml-auto");

    fireEvent.change(screen.getByLabelText("Search keyboard shortcuts"), {
      target: { value: "terminal" },
    });

    expect(screen.getByRole("heading", { name: "Current Workspace" })).toBeTruthy();
    expect(screen.getByText("Open terminal")).toBeTruthy();
    expect(screen.getByText("⌘J")).toBeTruthy();
    expect(screen.queryByText("Open browser tab")).toBeNull();
  });
});
