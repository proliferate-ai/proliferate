// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceActions } from "#product/components/workspace/shell/topbar/WorkspaceActionsMenu";

const nativeMenuState = vi.hoisted(() => ({
  show: vi.fn<() => Promise<boolean>>(),
}));

vi.mock("#product/hooks/workspaces/ui/use-workspace-actions-native-menu", () => ({
  useWorkspaceActionsNativeMenu: () => ({ showNativeMenu: nativeMenuState.show }),
}));

const session = {
  canRename: true,
  canFork: true,
  canDismiss: true,
  onRename: vi.fn(),
  onFork: vi.fn(),
  onDismiss: vi.fn(),
};

describe("WorkspaceActionsMenu", () => {
  afterEach(() => {
    cleanup();
    nativeMenuState.show.mockReset();
  });

  it("keeps the chat actions hit area flat with a keyboard-visible focus ring", () => {
    nativeMenuState.show.mockResolvedValue(true);
    render(<WorkspaceActions session={session} />);

    const trigger = screen.getByRole("button", { name: "Chat actions" });
    expect(trigger.className).toContain("workspace-shell-icon-button");
    expect(trigger.className).toContain("workspace-shell-icon-button--flat");
    expect(trigger.className).toContain("focus-ring");
    expect(trigger.className).toContain("app-region-no-drag");
    expect(trigger.className).not.toContain("workspace-shell-icon-button--hover-rim");
  });

  it("keeps the DOM menu closed when the native menu opens", async () => {
    nativeMenuState.show.mockResolvedValue(true);
    render(<WorkspaceActions session={session} />);

    fireEvent.pointerDown(screen.getByRole("button", { name: "Chat actions" }), {
      button: 0,
      ctrlKey: false,
    });

    await waitFor(() => expect(nativeMenuState.show).toHaveBeenCalledOnce());
    expect(screen.queryByText("Rename chat")).toBeNull();
  });

  it("opens the DOM fallback when the native menu cannot open", async () => {
    nativeMenuState.show.mockResolvedValue(false);
    render(<WorkspaceActions session={session} />);

    fireEvent.pointerDown(screen.getByRole("button", { name: "Chat actions" }), {
      button: 0,
      ctrlKey: false,
    });

    expect(await screen.findByText("Rename chat")).toBeTruthy();
  });

  it("disables archive when the active session must be preserved", async () => {
    nativeMenuState.show.mockResolvedValue(false);
    render(<WorkspaceActions session={{ ...session, canDismiss: false }} />);

    fireEvent.pointerDown(screen.getByRole("button", { name: "Chat actions" }), {
      button: 0,
      ctrlKey: false,
    });

    const archive = await screen.findByText("Archive chat");
    expect(archive.closest('[role="menuitem"]')?.getAttribute("data-disabled")).not.toBeNull();
  });
});
