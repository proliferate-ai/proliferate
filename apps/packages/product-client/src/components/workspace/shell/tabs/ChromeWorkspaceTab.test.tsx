// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChromeWorkspaceTab } from "#product/components/workspace/shell/tabs/ChromeWorkspaceTab";

describe("ChromeWorkspaceTab", () => {

  afterEach(cleanup);

  it("reveals a provided shortcut badge without changing tab label rendering", () => {
    render(
      <ChromeWorkspaceTab
        isActive
        width={180}
        icon={<span aria-hidden="true" />}
        label="Session one"
        shortcutLabel="⌘1"
        shortcutRevealVisible
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole("tab", { name: "Session one" })).toBeTruthy();
    const sessionTitle = screen.getByText("Session one");
    expect(sessionTitle.style.fontSize).toBe("var(--text-ui-sm)");
    expect(sessionTitle.style.lineHeight).toBe("var(--text-ui-sm--line-height)");
    expect(screen.getByText("⌘1").className).toContain("opacity-100");
  });
});
