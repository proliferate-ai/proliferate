// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SidebarNavRow } from "#product/primitives/patterns/sidebar/SidebarNavRow";

afterEach(cleanup);

describe("SidebarNavRow", () => {
  it("uses the shared primary sidebar icon size for its well and glyph", () => {
    const { container } = render(
      <SidebarNavRow
        label="New chat"
        icon={<svg data-testid="nav-icon" />}
        onPress={vi.fn()}
      />,
    );

    const icon = container.querySelector('[data-testid="nav-icon"]');
    const well = icon?.parentElement;
    expect(well?.className).toContain("w-[var(--icon-paired)]");
    // Well and glyph are the SAME tier: the well's compound selector beats any
    // plain size class on the child SVG, so this is what the nav (and the
    // settings sidebar, which passes its own `icon-paired`) actually renders.
    expect(well?.className).toContain("[&>svg]:icon-paired");
    expect(well?.className).not.toContain("[&>svg]:icon-indicator");
  });

  it("mounts the shortcut badge only while shortcut reveal is active", () => {
    const { rerender } = render(
      <SidebarNavRow
        label="New chat"
        shortcutLabel="⌘N"
        onPress={vi.fn()}
      />,
    );

    expect(screen.queryByText("⌘N")).toBeNull();

    rerender(
      <SidebarNavRow
        label="New chat"
        shortcutLabel="⌘N"
        shortcutRevealVisible
        onPress={vi.fn()}
      />,
    );

    expect(screen.getByText("⌘N")).toBeTruthy();
  });

  it("overlays a shortcut on an existing trailing status", () => {
    render(
      <SidebarNavRow
        label="New chat"
        status={<span>beta</span>}
        shortcutLabel="⌘N"
        shortcutRevealVisible
        onPress={vi.fn()}
      />,
    );

    expect(screen.getByText("beta").parentElement?.className).toContain("opacity-0");
    const shortcut = screen.getByText("⌘N");
    expect(shortcut.className).toContain("absolute");
    expect(shortcut.getAttribute("data-sidebar-shortcut-overlay")).toBe("true");
  });
});
