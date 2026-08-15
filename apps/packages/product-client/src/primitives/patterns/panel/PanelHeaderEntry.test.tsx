// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

  it("shows the dirty marker only when dirty, as StatusDot's decorative form", () => {
    const { container, rerender } = render(<PanelHeaderEntry label="Scratch" onSelect={vi.fn()} />);
    expect(container.querySelector(".rounded-full")).toBeNull();

    rerender(<PanelHeaderEntry label="Scratch" dirty onSelect={vi.fn()} />);
    const dot = container.querySelector(".rounded-full");
    // The `StatusDot` primitive on `current`, not a second hand-rolled dot:
    // `inline-block icon-status … bg-current` is its class signature, and with
    // no label it stays decorative so the entry keeps its own accessible name.
    expect(dot?.className).toContain("inline-block icon-status");
    expect(dot?.className).toContain("bg-current");
    expect(dot?.getAttribute("aria-hidden")).toBe("true");
    expect(dot?.getAttribute("role")).toBeNull();
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

  it("keeps a roving-tabIndex floor so an all-inactive strip stays keyboard-reachable", async () => {
    const user = userEvent.setup();
    render(
      <>
        <PanelHeaderEntry label="Scratch" onSelect={vi.fn()} tabIndexFloor />
        <PanelHeaderEntry label="Changes" onSelect={vi.fn()} />
      </>,
    );

    const scratch = screen.getByRole("tab", { name: "Scratch" });
    const changes = screen.getByRole("tab", { name: "Changes" });
    expect(scratch.getAttribute("tabindex")).toBe("0");
    expect(changes.getAttribute("tabindex")).toBe("-1");

    await user.tab();
    expect(document.activeElement).toBe(scratch);
  });

  it("does not grant the floor to a disabled entry", () => {
    render(
      <PanelHeaderEntry label="Scratch" onSelect={vi.fn()} disabled tabIndexFloor />,
    );

    const entry = screen.getByRole("tab", { name: "Scratch" });
    expect(entry.getAttribute("tabindex")).toBe("-1");
  });
});
