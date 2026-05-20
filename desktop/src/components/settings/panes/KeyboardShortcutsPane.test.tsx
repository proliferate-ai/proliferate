// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KeyboardShortcutsPane } from "@/components/settings/panes/KeyboardShortcutsPane";

describe("KeyboardShortcutsPane", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders shortcuts in a searchable Codex-style keybinding table", () => {
    vi.stubGlobal("navigator", {
      platform: "MacIntel",
      userAgent: "Mac OS X",
    });

    render(<KeyboardShortcutsPane />);

    expect(screen.getByRole("heading", { name: "Keyboard shortcuts" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Command" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Keybinding" })).toBeTruthy();
    expect(screen.getByText("Open browser tab")).toBeTruthy();
    expect(screen.getByText("⌘T")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Search keyboard shortcuts"), {
      target: { value: "terminal" },
    });

    expect(screen.getByText("Open terminal")).toBeTruthy();
    expect(screen.getByText("⌘J")).toBeTruthy();
    expect(screen.queryByText("Open browser tab")).toBeNull();
  });
});
