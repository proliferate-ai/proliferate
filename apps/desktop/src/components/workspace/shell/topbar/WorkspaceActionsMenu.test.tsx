// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceActionsMenu } from "./WorkspaceActionsMenu";

const nativeMenuState = vi.hoisted(() => ({
  show: vi.fn<() => Promise<boolean>>(),
}));

vi.mock("@/hooks/workspaces/ui/use-workspace-actions-native-menu", () => ({
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

  it("keeps the DOM menu closed when the native menu opens", async () => {
    nativeMenuState.show.mockResolvedValue(true);
    render(<WorkspaceActionsMenu session={session} />);

    fireEvent.pointerDown(screen.getByRole("button", { name: "Chat actions" }), {
      button: 0,
      ctrlKey: false,
    });

    await waitFor(() => expect(nativeMenuState.show).toHaveBeenCalledOnce());
    expect(screen.queryByText("Rename chat")).toBeNull();
  });

  it("opens the DOM fallback when the native menu cannot open", async () => {
    nativeMenuState.show.mockResolvedValue(false);
    render(<WorkspaceActionsMenu session={session} />);

    fireEvent.pointerDown(screen.getByRole("button", { name: "Chat actions" }), {
      button: 0,
      ctrlKey: false,
    });

    expect(await screen.findByText("Rename chat")).toBeTruthy();
  });
});
