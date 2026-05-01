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

  it("keeps the delete workspace context menu open after right-clicking", async () => {
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

    expect(await screen.findByRole("button", { name: "Delete workspace..." })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Delete workspace" })).toBeNull();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("does not select the workspace when confirming delete from the context menu", () => {
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

    fireEvent.contextMenu(row!);
    fireEvent.click(screen.getByRole("button", { name: "Delete workspace..." }));
    fireEvent.click(screen.getByRole("button", { name: "Delete workspace" }));

    expect(onMarkDone).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
