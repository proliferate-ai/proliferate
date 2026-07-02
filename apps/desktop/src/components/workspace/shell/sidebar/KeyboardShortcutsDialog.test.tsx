/* @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KeyboardShortcutsDialog } from "@/components/workspace/shell/sidebar/KeyboardShortcutsDialog";
import { useKeyboardShortcutsDialogStore } from "@/stores/shortcuts/keyboard-shortcuts-dialog-store";

describe("KeyboardShortcutsDialog", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    useKeyboardShortcutsDialogStore.setState({ open: false });
  });

  it("opens from the store and renders grouped shortcut rows", () => {
    vi.stubGlobal("navigator", {
      platform: "MacIntel",
      userAgent: "Mac OS X",
    });

    render(<KeyboardShortcutsDialog />);

    expect(screen.queryByText("Keyboard shortcuts")).toBeNull();

    act(() => {
      useKeyboardShortcutsDialogStore.getState().setOpen(true);
    });

    expect(screen.getByText("Keyboard shortcuts")).toBeTruthy();
    expect(screen.getByText("App")).toBeTruthy();
    expect(screen.getByText("Tabs")).toBeTruthy();
    expect(screen.getByText("New chat")).toBeTruthy();
    expect(screen.getByText("⌘T")).toBeTruthy();
  });

  it("filters rows by search and resets the query and store on close", () => {
    vi.stubGlobal("navigator", {
      platform: "MacIntel",
      userAgent: "Mac OS X",
    });

    render(<KeyboardShortcutsDialog />);

    act(() => {
      useKeyboardShortcutsDialogStore.getState().setOpen(true);
    });

    fireEvent.change(screen.getByPlaceholderText("Search shortcuts"), {
      target: { value: "terminal" },
    });

    expect(screen.getByText("Open terminal")).toBeTruthy();
    expect(screen.getByText("⌘J")).toBeTruthy();
    expect(screen.queryByText("New chat")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(useKeyboardShortcutsDialogStore.getState().open).toBe(false);
    expect(screen.queryByText("Keyboard shortcuts")).toBeNull();

    act(() => {
      useKeyboardShortcutsDialogStore.getState().setOpen(true);
    });

    const searchInput = screen.getByPlaceholderText("Search shortcuts");
    expect((searchInput as HTMLInputElement).value).toBe("");
    expect(screen.getByText("New chat")).toBeTruthy();
  });
});
