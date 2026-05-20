// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SHORTCUTS } from "@/config/shortcuts";
import { RightPanelNewTabMenu } from "@/components/workspace/shell/right-panel/RightPanelNewTabMenu";
import { getShortcutDisplayLabel } from "@/lib/domain/shortcuts/matching";

describe("RightPanelNewTabMenu", () => {
  afterEach(cleanup);

  it("reveals the browser-tab shortcut whenever the workspace is ready", () => {
    const label = getShortcutDisplayLabel(SHORTCUTS.openBrowserTab);

    const rendered = render(
      <RightPanelNewTabMenu
        open={false}
        defaultKind="browser"
        isWorkspaceReady
        onOpenChange={vi.fn()}
        onCreateTerminal={vi.fn()}
        onCreateBrowser={vi.fn()}
        shortcutRevealVisible
      />,
    );

    expect(screen.getByText(label).className).toContain("opacity-100");

    rendered.rerender(
      <RightPanelNewTabMenu
        open={false}
        defaultKind="browser"
        isWorkspaceReady={false}
        onOpenChange={vi.fn()}
        onCreateTerminal={vi.fn()}
        onCreateBrowser={vi.fn()}
        shortcutRevealVisible
      />,
    );

    expect(screen.queryByText(label)).toBeNull();
  });
});
