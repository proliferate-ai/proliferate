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
    expect(screen.getByText("New chat")).toBeTruthy();
    const newChatRow = screen.getByText("New chat").closest("li");
    if (!(newChatRow instanceof HTMLElement)) {
      throw new Error("Expected new chat shortcut row");
    }
    expect(within(newChatRow).getByText("⌘T").closest("div")?.className).toContain("ml-auto");

    const previousTabRow = screen.getByText("Previous tab").closest("li");
    if (!(previousTabRow instanceof HTMLElement)) {
      throw new Error("Expected previous tab shortcut row");
    }
    expect(within(previousTabRow).getByText("⌘⇧[")).toBeTruthy();
    expect(within(previousTabRow).getByText("⌘⌥<")).toBeTruthy();

    const closeOtherTabsRow = screen.getByText("Close other tabs").closest("li");
    if (!(closeOtherTabsRow instanceof HTMLElement)) {
      throw new Error("Expected close other tabs shortcut row");
    }
    expect(within(closeOtherTabsRow).getByText("⌘⌥O")).toBeTruthy();
    expect(within(closeOtherTabsRow).getByText("⌘⇧O")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Search keyboard shortcuts"), {
      target: { value: "⌘⌥<" },
    });

    expect(screen.getByText("Previous tab")).toBeTruthy();
    expect(screen.getByText("⌘⌥<")).toBeTruthy();
    expect(screen.queryByText("Next tab")).toBeNull();

    fireEvent.change(screen.getByLabelText("Search keyboard shortcuts"), {
      target: { value: "terminal" },
    });

    expect(screen.getByRole("heading", { name: "Current Workspace" })).toBeTruthy();
    expect(screen.getByText("Open terminal")).toBeTruthy();
    expect(screen.getByText("⌘J")).toBeTruthy();
    expect(screen.queryByText("New chat")).toBeNull();
  });
});
