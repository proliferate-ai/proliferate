/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceShellRightPanelToggle } from "#product/components/workspace/shell/screen/WorkspaceShellRightPanelToggle";

vi.mock("#product/providers/ShortcutRevealProvider", () => ({
  useShortcutRevealVisible: () => false,
}));

describe("WorkspaceShellRightPanelToggle", () => {
  afterEach(cleanup);

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
});
