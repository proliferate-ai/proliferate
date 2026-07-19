// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RightPanelNewTabMenu } from "#product/components/workspace/shell/right-panel/RightPanelNewTabMenu";

function ProgrammaticPickerHarness({
  onCreateTerminal = vi.fn(),
}: {
  onCreateTerminal?: () => void;
}) {
  const [open, setOpen] = useState(true);

  return (
    <>
      <button type="button">Outside target</button>
      <RightPanelNewTabMenu
        open={open}
        defaultKind="terminal"
        isWorkspaceReady
        onOpenChange={setOpen}
        onCreateTerminal={onCreateTerminal}
      />
    </>
  );
}

describe("RightPanelNewTabMenu", () => {
  afterEach(cleanup);

  it("creates exactly one terminal for each direct plus click", async () => {
    const user = userEvent.setup();
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
    await user.click(createButton);
    await user.click(createButton);

    expect(onCreateTerminal).toHaveBeenCalledTimes(2);
    expect(onOpenChange).toHaveBeenNthCalledWith(1, false);
    expect(onOpenChange).toHaveBeenNthCalledWith(2, false);
    expect(screen.queryByRole("menuitem", { name: "Terminal" })).toBeNull();
  });

  it("uses truthful button semantics and creates once for Enter and Space", async () => {
    const user = userEvent.setup();
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
    expect(createButton.getAttribute("aria-haspopup")).toBeNull();
    expect(createButton.getAttribute("aria-expanded")).toBeNull();
    expect(createButton.getAttribute("data-state")).toBeNull();
    expect(createButton.getAttribute("data-slot")).toBeNull();

    createButton.focus();
    await user.keyboard("{Enter}");
    expect(onCreateTerminal).toHaveBeenCalledTimes(1);

    await user.keyboard(" ");
    expect(onCreateTerminal).toHaveBeenCalledTimes(2);
    expect(onOpenChange).toHaveBeenCalledTimes(2);
    expect(onOpenChange).toHaveBeenNthCalledWith(1, false);
    expect(onOpenChange).toHaveBeenNthCalledWith(2, false);
  });

  it("keeps the explicit programmatic picker path available", async () => {
    const { container } = render(<ProgrammaticPickerHarness />);

    const trigger = container.querySelector<HTMLButtonElement>(
      "[data-slot='dropdown-menu-trigger']",
    );
    expect(trigger).not.toBeNull();
    expect(trigger?.getAttribute("aria-haspopup")).toBe("menu");
    expect(trigger?.getAttribute("aria-expanded")).toBe("true");

    const terminalItem = await screen.findByRole("menuitem", { name: "Terminal" });
    await waitFor(() => expect(document.activeElement).toBe(terminalItem));
  });

  it("returns focus to the truthful direct button after Escape", async () => {
    const user = userEvent.setup();
    render(<ProgrammaticPickerHarness />);

    const terminalItem = await screen.findByRole("menuitem", { name: "Terminal" });
    await waitFor(() => expect(document.activeElement).toBe(terminalItem));

    await user.keyboard("{Escape}");

    const createButton = await screen.findByRole("button", { name: "New terminal" });
    await waitFor(() => expect(document.activeElement).toBe(createButton));
    expect(createButton.getAttribute("aria-haspopup")).toBeNull();
    expect(createButton.getAttribute("aria-expanded")).toBeNull();
    expect(createButton.getAttribute("data-state")).toBeNull();
    expect(createButton.getAttribute("data-slot")).toBeNull();
  });

  it("keeps a failed picker creation on the meaningful direct button", async () => {
    const user = userEvent.setup();
    const onCreateTerminal = vi.fn();
    render(<ProgrammaticPickerHarness onCreateTerminal={onCreateTerminal} />);

    const terminalItem = await screen.findByRole("menuitem", { name: "Terminal" });
    await waitFor(() => expect(document.activeElement).toBe(terminalItem));
    await user.click(terminalItem);

    const createButton = await screen.findByRole("button", { name: "New terminal" });
    await waitFor(() => expect(document.activeElement).toBe(createButton));
    expect(onCreateTerminal).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menuitem", { name: "Terminal" })).toBeNull();
  });

  it("does not steal focus on outside-pointer dismissal", async () => {
    const { container } = render(<ProgrammaticPickerHarness />);

    const terminalItem = await screen.findByRole("menuitem", { name: "Terminal" });
    await waitFor(() => expect(document.activeElement).toBe(terminalItem));

    const outsideTarget = screen.getByText("Outside target").closest("button")!;
    const createButton = container.querySelector<HTMLButtonElement>(
      '[aria-label="New terminal"]',
    )!;
    fireEvent.pointerDown(outsideTarget);

    await waitFor(() => {
      expect(screen.queryByRole("menuitem", { name: "Terminal" })).toBeNull();
    });
    expect(document.activeElement).not.toBe(createButton);
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
