// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SidebarRepositoriesHeader } from "#product/components/workspace/shell/sidebar/SidebarRepositoriesHeader";

afterEach(cleanup);

function renderHeader(onAddRepo = vi.fn()) {
  render(
    <SidebarRepositoriesHeader
      repositoriesCollapsed={false}
      filtersActive={false}
      workspaceTypes={["local", "worktree", "cloud", "ssh"]}
      onToggleRepositoriesCollapsed={vi.fn()}
      onToggleWorkspaceType={vi.fn()}
      onNewChat={vi.fn()}
      onAddRepo={onAddRepo}
    />,
  );
  return onAddRepo;
}

describe("SidebarRepositoriesHeader", () => {
  it("opens Add repository from the options button", () => {
    const onAddRepo = renderHeader();

    fireEvent.click(screen.getByRole("button", { name: "Repository options" }));
    fireEvent.click(screen.getByRole("button", { name: "Add repository…" }));

    expect(onAddRepo).toHaveBeenCalledTimes(1);
  });

  it("lets a right-click on the nested options button open the header context menu", () => {
    const onAddRepo = renderHeader();

    fireEvent.contextMenu(screen.getByRole("button", { name: "Repository options" }), {
      clientX: 24,
      clientY: 32,
    });
    fireEvent.click(screen.getByRole("button", { name: "Add repository…" }));

    expect(onAddRepo).toHaveBeenCalledTimes(1);
  });
});
