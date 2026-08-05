// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ProductSidebarWorkspaceRow } from "./ProductSidebarRepositories";

afterEach(cleanup);

describe("ProductSidebarWorkspaceRow trailing slot", () => {
  it("renders the quieter unread dot in the shared right slot instead of the date", () => {
    render(
      <ProductSidebarWorkspaceRow
        label="Unread workspace"
        unreadDot
        trailingLabel="2m"
      />,
    );

    const unreadDot = screen.getByRole("img", { name: "Unseen activity" });
    expect(unreadDot.className).toContain("icon-status");
    expect(unreadDot.className).toContain("bg-sidebar-status-unseen");
    expect(screen.queryByText("2m")).toBeNull();
    expect(unreadDot.closest("[data-sidebar-trailing-cells]")).not.toBeNull();
  });

  it("gives live status precedence over unread and date in that same slot", () => {
    render(
      <ProductSidebarWorkspaceRow
        label="Running workspace"
        trailingStatus={<span data-testid="running-status">Running</span>}
        unreadDot
        trailingLabel="now"
      />,
    );

    expect(screen.getByTestId("running-status")).not.toBeNull();
    expect(screen.queryByRole("img", { name: "Unseen activity" })).toBeNull();
    expect(screen.queryByText("now")).toBeNull();
  });

  it("uses the same right-slot geometry for an idle date", () => {
    render(
      <ProductSidebarWorkspaceRow label="Idle workspace" trailingLabel="4h" />,
    );

    const date = screen.getByText("4h");
    expect(
      date.closest("[data-sidebar-trailing-cells]")?.parentElement?.className,
    ).toContain("min-w-5");
    // The timestamp is meta text, a step below the row's own type role.
    expect(date.className).toContain("text-ui-sm");
  });

  it("right-packs a lone identity and orders identity before live status", () => {
    const { rerender } = render(
      <ProductSidebarWorkspaceRow
        label="Worktree"
        trailingIdentity={<span data-testid="identity">Branch</span>}
      />,
    );

    let cells = screen.getByTestId("identity").closest("[data-sidebar-trailing-cells]");
    expect(cells?.children).toHaveLength(1);

    rerender(
      <ProductSidebarWorkspaceRow
        label="Running worktree"
        trailingIdentity={<span data-testid="identity">Branch</span>}
        trailingStatus={<span data-testid="running-status">Running</span>}
      />,
    );
    cells = screen.getByTestId("identity").closest("[data-sidebar-trailing-cells]");
    expect(cells?.children).toHaveLength(2);
    expect(cells?.children[0]?.textContent).toBe("Branch");
    expect(cells?.children[1]?.textContent).toBe("Running");
    expect(cells?.className).toContain("gap-1.5");
  });

  it("overlays the shortcut on the rightmost symbol without adding a trailing slot", () => {
    const { rerender } = render(
      <ProductSidebarWorkspaceRow
        label="Shortcut workspace"
        trailingIdentity={<span data-testid="identity">Branch</span>}
        trailingStatus={<span data-testid="running-status">Running</span>}
        shortcutLabel="⌘1"
      />,
    );

    expect(screen.queryByText("⌘1")).toBeNull();
    let cells = screen.getByTestId("identity").closest("[data-sidebar-trailing-cells]");
    expect(cells?.children).toHaveLength(2);

    rerender(
      <ProductSidebarWorkspaceRow
        label="Shortcut workspace"
        trailingIdentity={<span data-testid="identity">Branch</span>}
        trailingStatus={<span data-testid="running-status">Running</span>}
        shortcutLabel="⌘1"
        shortcutRevealVisible
      />,
    );

    const shortcut = screen.getByText("⌘1");
    cells = shortcut.closest("[data-sidebar-trailing-cells]");
    expect(cells).not.toBeNull();
    expect(cells?.children).toHaveLength(3);
    expect(shortcut.className).toContain("absolute");
    expect(shortcut.className).toContain("right-0");
    expect(shortcut.getAttribute("data-sidebar-shortcut-overlay")).toBe("true");
    expect(screen.getByTestId("identity").parentElement?.className).not.toContain("opacity-0");
    expect(screen.getByTestId("running-status").parentElement?.className).toContain("opacity-0");
  });

  it("uses the ordinary trailing slot when there is no symbol to cover", () => {
    render(
      <ProductSidebarWorkspaceRow
        label="Shortcut workspace"
        shortcutLabel="⌘1"
        shortcutRevealVisible
      />,
    );

    const shortcut = screen.getByText("⌘1");
    expect(shortcut.className).not.toContain("absolute");
    expect(shortcut.hasAttribute("data-sidebar-shortcut-overlay")).toBe(false);
  });
});
