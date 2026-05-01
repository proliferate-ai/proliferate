// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { WorkspaceItem } from "./WorkspaceItem";

vi.mock("@/platform/tauri/context-menu", () => ({
  canShowNativeContextMenu: () => false,
  showNativeContextMenu: vi.fn(),
}));

describe("WorkspaceItem", () => {
  afterEach(() => {
    cleanup();
  });

  it("keeps the mark-done context menu open after right-clicking", async () => {
    const onSelect = vi.fn();

    render(
      <WorkspaceItem
        name="Feature worktree"
        variant="worktree"
        onSelect={onSelect}
        onMarkDone={vi.fn()}
      />,
    );

    const row = screen.getByText("Feature worktree").closest('[role="button"]');
    expect(row).not.toBeNull();

    fireEvent.contextMenu(row!, { clientX: 12, clientY: 12 });

    expect(await screen.findByRole("button", { name: "Mark done..." })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Confirm done" })).toBeNull();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("does not select the workspace when confirming mark done from the context menu", async () => {
    const onSelect = vi.fn();
    const onMarkDone = vi.fn();

    render(
      <WorkspaceItem
        name="Feature worktree"
        variant="worktree"
        onSelect={onSelect}
        onMarkDone={onMarkDone}
      />,
    );

    const row = screen.getByText("Feature worktree").closest('[role="button"]');
    expect(row).not.toBeNull();

    fireEvent.contextMenu(row!, { clientX: 12, clientY: 12 });
    fireEvent.click(await screen.findByRole("button", { name: "Mark done..." }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm done" }));

    expect(onMarkDone).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
