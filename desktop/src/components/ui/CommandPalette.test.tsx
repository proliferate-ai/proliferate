/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import {
  CommandPaletteInput,
  CommandPaletteItem,
  CommandPaletteList,
  CommandPaletteRoot,
  useCommandPaletteClose,
} from "@/components/ui/CommandPalette";

beforeEach(() => {
  class TestResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal("ResizeObserver", TestResizeObserver);
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    callback(0);
    return 1;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function EscapeHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      <CommandPaletteRoot
        open={open}
        onClose={() => setOpen(false)}
        label="Command palette"
      >
        <CommandPaletteInput placeholder="Search" />
        <CommandPaletteList>
          <CommandPaletteItem value="item">Item</CommandPaletteItem>
        </CommandPaletteList>
      </CommandPaletteRoot>
    </>
  );
}

function ActionCloseItem() {
  const close = useCommandPaletteClose();
  return (
    <CommandPaletteItem
      value="focus-chat"
      onSelect={() => close({ restoreFocus: false })}
    >
      Focus Chat
    </CommandPaletteItem>
  );
}

function ActionHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      <CommandPaletteRoot
        open={open}
        onClose={() => setOpen(false)}
        label="Command palette"
      >
        <CommandPaletteInput placeholder="Search" />
        <CommandPaletteList>
          <ActionCloseItem />
        </CommandPaletteList>
      </CommandPaletteRoot>
    </>
  );
}

describe("CommandPalette", () => {
  it("renders as a blocked dialog and restores focus on Escape", async () => {
    render(<EscapeHarness />);
    const opener = screen.getByRole("button", { name: "Open" });
    opener.focus();
    fireEvent.click(opener);

    const dialog = screen.getByRole("dialog", { name: "Command palette" });
    const input = screen.getByPlaceholderText("Search");
    const list = document.querySelector("[cmdk-list]");
    expect(dialog.parentElement?.hasAttribute("data-telemetry-block")).toBe(true);
    expect(input.hasAttribute("data-telemetry-mask")).toBe(true);
    expect(list?.hasAttribute("data-telemetry-mask")).toBe(true);
    await waitFor(() => expect(document.activeElement).toBe(input));

    fireEvent.keyDown(dialog, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(opener);
  });

  it("can close from an action without restoring prior focus", async () => {
    render(<ActionHarness />);
    const opener = screen.getByRole("button", { name: "Open" });
    opener.focus();
    fireEvent.click(opener);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByPlaceholderText("Search")));

    fireEvent.click(screen.getByText("Focus Chat"));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).not.toBe(opener);
  });
});
