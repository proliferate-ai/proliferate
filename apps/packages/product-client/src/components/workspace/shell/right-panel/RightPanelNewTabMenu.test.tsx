// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RightPanelNewTabMenu } from "#product/components/workspace/shell/right-panel/RightPanelNewTabMenu";

describe("RightPanelNewTabMenu", () => {
  afterEach(cleanup);

  it("creates exactly one terminal for each direct plus click", () => {
    const onCreateTerminal = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <RightPanelNewTabMenu
        open={false}
        defaultKind="terminal"
        isWorkspaceReady
        onOpenChange={onOpenChange}
        onCreateTerminal={onCreateTerminal}
      />,
    );

    const createButton = screen.getByRole("button", { name: "New terminal" });
    fireEvent.click(createButton);
    fireEvent.click(createButton);

    expect(onCreateTerminal).toHaveBeenCalledTimes(2);
    expect(onOpenChange).toHaveBeenNthCalledWith(1, false);
    expect(onOpenChange).toHaveBeenNthCalledWith(2, false);
    expect(screen.queryByRole("menuitem", { name: "Terminal" })).toBeNull();
  });

  it("keeps the explicit programmatic picker path available", async () => {
    render(
      <RightPanelNewTabMenu
        open
        defaultKind="terminal"
        isWorkspaceReady
        onOpenChange={vi.fn()}
        onCreateTerminal={vi.fn()}
      />,
    );

    expect(await screen.findByRole("menuitem", { name: "Terminal" })).toBeTruthy();
  });

  it("disables terminal creation until the workspace is ready", () => {
    const onCreateTerminal = vi.fn();
    render(
      <RightPanelNewTabMenu
        open={false}
        defaultKind="terminal"
        isWorkspaceReady={false}
        onOpenChange={vi.fn()}
        onCreateTerminal={onCreateTerminal}
      />,
    );

    const createButton = screen.getByRole("button", { name: "New terminal" });
    expect((createButton as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(createButton);
    expect(onCreateTerminal).not.toHaveBeenCalled();
  });

  it("does not advertise a global new-tab shortcut", () => {
    const rendered = render(
      <RightPanelNewTabMenu
        open={false}
        defaultKind="terminal"
        isWorkspaceReady
        onOpenChange={vi.fn()}
        onCreateTerminal={vi.fn()}
      />,
    );

    expect(screen.queryByText("⌘T")).toBeNull();

    rendered.rerender(
      <RightPanelNewTabMenu
        open={false}
        defaultKind="terminal"
        isWorkspaceReady={false}
        onOpenChange={vi.fn()}
        onCreateTerminal={vi.fn()}
      />,
    );

    expect(screen.queryByText("⌘T")).toBeNull();
  });
});
