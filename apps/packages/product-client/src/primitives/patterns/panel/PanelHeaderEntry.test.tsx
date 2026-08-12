// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PanelHeaderEntry } from "#product/primitives/patterns/panel/PanelHeaderEntry";

afterEach(cleanup);

describe("PanelHeaderEntry", () => {
  it("owns its interaction-state stack from the shared state tokens", () => {
    render(<PanelHeaderEntry label="Changes" onSelect={vi.fn()} />);

    const entry = screen.getByRole("tab", { name: "Changes" });
    expect(entry.className).toContain("hover:bg-hover");
    expect(entry.className).toContain("active:bg-active");
    expect(entry.className).toContain("focus-visible:outline-sidebar-ring");
    expect(entry.className).not.toContain("bg-selected");
  });

  it("paints a selected entry with the selection token and the roving tabindex", () => {
    render(<PanelHeaderEntry label="Changes" active onSelect={vi.fn()} />);

    const entry = screen.getByRole("tab", { name: "Changes" });
    expect(entry.className).toContain("bg-selected");
    expect(entry.className).not.toContain("hover:bg-hover");
    expect(entry.getAttribute("aria-selected")).toBe("true");
    expect(entry.getAttribute("tabindex")).toBe("0");
  });

  it("renders the close control only when a close handler is supplied", () => {
    const onClose = vi.fn();
    const { rerender } = render(<PanelHeaderEntry label="Scratch" onSelect={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Close Scratch" })).toBeNull();

    rerender(<PanelHeaderEntry label="Scratch" onSelect={vi.fn()} onClose={onClose} />);
    const close = screen.getByRole("button", { name: "Close Scratch" });
    close.click();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps the entry selectable while its close control is disabled", () => {
    render(
      <PanelHeaderEntry
        label="zsh"
        onSelect={vi.fn()}
        onClose={vi.fn()}
        closeDisabled
      />,
    );

    const entry = screen.getByRole("tab", { name: "zsh" }) as HTMLButtonElement;
    const close = screen.getByRole("button", { name: "Close zsh" }) as HTMLButtonElement;
    expect(entry.disabled).toBe(false);
    expect(close.disabled).toBe(true);
  });
});
