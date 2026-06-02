// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RightPanelNewTabMenu } from "@/components/workspace/shell/right-panel/RightPanelNewTabMenu";

describe("RightPanelNewTabMenu", () => {

  afterEach(cleanup);

  it("does not advertise a global browser-tab shortcut", () => {
    const rendered = render(
      <RightPanelNewTabMenu
        open={false}
        defaultKind="browser"
        isWorkspaceReady
        onOpenChange={vi.fn()}
        onCreateTerminal={vi.fn()}
        onCreateBrowser={vi.fn()}
      />,
    );

    expect(screen.queryByText("⌘T")).toBeNull();

    rendered.rerender(
      <RightPanelNewTabMenu
        open={false}
        defaultKind="browser"
        isWorkspaceReady={false}
        onOpenChange={vi.fn()}
        onCreateTerminal={vi.fn()}
        onCreateBrowser={vi.fn()}
      />,
    );

    expect(screen.queryByText("⌘T")).toBeNull();
  });
});
