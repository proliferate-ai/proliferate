// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { WorkspaceItem } from "./WorkspaceItem";

describe("WorkspaceItem", () => {
  afterEach(() => {
    cleanup();
  });

  it("does not select the workspace when confirming mark done from the context menu", () => {
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
    fireEvent.click(screen.getByRole("button", { name: "Mark done..." }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm done" }));

    expect(onMarkDone).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
