// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChromeTab } from "#product/primitives/patterns/tabs/ChromeTab";

describe("ChromeTab", () => {
  afterEach(cleanup);

  it("renders an active tab full-height with an instant bottom underline", () => {
    const { container } = render(
      <ChromeTab
        isActive
        width={180}
        label="Session one"
        badge={<span aria-hidden="true">Working</span>}
        shortcutLabel="⌘1"
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const tabButton = screen.getByRole("tab", { name: "Session one" });
    expect(tabButton.className).toContain("h-full");
    expect(tabButton.className).toContain("px-(--workspace-shell-tab-inline-padding)");
    expect(tabButton.className).toContain("py-0");
    const sessionTitle = screen.getByText("Session one");
    expect(sessionTitle.className).toContain("workspace-shell-tab__label");
    expect(sessionTitle.className).toContain("flex-1");
    expect(sessionTitle.className).toContain("font-medium");
    expect(sessionTitle.style.maskImage).toBe("");
    expect(sessionTitle.style.webkitMaskImage).toBe("");
    expect(screen.queryByText("⌘1")).toBeNull();
    const statusSlot = screen.getByText("Working").parentElement;
    expect(statusSlot?.className).toContain("workspace-shell-tab__status");

    const tabRoot = container.querySelector(".workspace-shell-tab");
    expect(tabRoot?.getAttribute("data-has-status")).toBe("true");
    const underline = container.querySelector(".workspace-shell-tab__underline");
    expect(tabRoot?.className).toContain("h-full");
    expect(underline?.parentElement).toBe(tabRoot);
    expect(underline?.className).not.toContain("transition");
  });

  it("does not render an underline or label-edge mask for an inactive tab", () => {
    const { container } = render(
      <ChromeTab
        isActive={false}
        width={180}
        label="Session two"
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const sessionTitle = screen.getByText("Session two");
    expect(sessionTitle.className).toContain("text-sidebar-muted-foreground");
    expect(sessionTitle.className).toContain("group-hover/tab:text-sidebar-foreground");
    expect(sessionTitle.style.maskImage).toBe("");
    expect(sessionTitle.style.webkitMaskImage).toBe("");
    expect(container.querySelector(".workspace-shell-tab__underline")).toBeNull();
  });

  it("yields the trailing status slot to a revealed shortcut", () => {
    render(
      <ChromeTab
        isActive
        width={180}
        label="Session one"
        badge={<span aria-hidden="true">Working</span>}
        shortcutLabel="⌘1"
        shortcutRevealVisible
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("Working").parentElement?.className).toContain("opacity-0");
    expect(screen.getByText("⌘1").className).toContain("workspace-shell-tab__shortcut");
  });
});
