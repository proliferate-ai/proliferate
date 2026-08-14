/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceShellRightPanelToggle } from "#product/components/workspace/shell/screen/WorkspaceShellRightPanelToggle";

const reveal = vi.hoisted(() => ({ visible: false }));

vi.mock("#product/providers/ShortcutRevealProvider", () => ({
  useShortcutRevealVisible: () => reveal.visible,
}));

describe("WorkspaceShellRightPanelToggle", () => {
  afterEach(() => {
    reveal.visible = false;
    cleanup();
  });

  it("keeps one window-pinned button mounted across panel state changes", () => {
    const onTogglePanel = vi.fn();
    const { rerender } = render(
      <WorkspaceShellRightPanelToggle open={false} onTogglePanel={onTogglePanel} />,
    );
    const button = screen.getByRole("button", { name: "Toggle side panel" });
    const chrome = button.parentElement;

    expect(chrome?.className).toContain("absolute right-2 top-0");
    expect(chrome?.className).not.toContain("opacity");
    expect(button.className).toContain("text-muted-foreground");

    rerender(<WorkspaceShellRightPanelToggle open onTogglePanel={onTogglePanel} />);

    expect(screen.getByRole("button", { name: "Toggle side panel" })).toBe(button);
    expect(button.className).toContain("text-sidebar-muted-foreground");
    expect(button.className).toContain("glass-editor-panel-new-tab-menu-trigger");
    fireEvent.click(button);
    expect(onTogglePanel).toHaveBeenCalledOnce();
  });

  it("swaps the icon for a centered shortcut badge while shortcuts are revealed", () => {
    reveal.visible = true;
    const { container } = render(
      <WorkspaceShellRightPanelToggle open={false} onTogglePanel={vi.fn()} />,
    );

    const icon = container.querySelector("svg");
    expect(icon?.getAttribute("class")).toContain("invisible");

    const badge = container.querySelector("kbd");
    expect(badge?.getAttribute("aria-hidden")).toBe("true");
    expect(badge?.className).toContain("-translate-x-1/2");
    expect(badge?.className).toContain("-translate-y-1/2");
    expect(badge?.className).not.toContain("-right-1");
    expect(badge?.parentElement).toBe(
      screen.getByRole("button", { name: "Toggle side panel" }),
    );
  });
});
