// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SidebarRepositoriesHeader } from "#product/components/workspace/shell/sidebar/SidebarRepositoriesHeader";

// The panel's own wiring (readiness, GitHub App queries, the native picker)
// has its own tests; here only the anchoring matters.
vi.mock("#product/components/workspace/repo-setup/AddRepositoryFlowPanel", () => ({
  AddRepositoryFlowPanel: () => <div>add-repository-flow</div>,
}));

afterEach(cleanup);

function renderHeader(onAddRepo = vi.fn()) {
  render(
    <SidebarRepositoriesHeader
      repositoriesCollapsed={false}
      filtersActive={false}
      workspaceTypes={["local", "worktree", "cloud"]}
      onToggleRepositoriesCollapsed={vi.fn()}
      onToggleWorkspaceType={vi.fn()}
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

  it("opens the add-repository flow from the section's own plus button", () => {
    renderHeader();

    expect(screen.queryByText("add-repository-flow")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add repository" }));

    expect(screen.getByText("add-repository-flow")).toBeTruthy();
  });

  it("names the flow it raises, which a bare + cannot", () => {
    renderHeader();

    fireEvent.click(screen.getByRole("button", { name: "Add repository" }));

    expect(screen.getByRole("dialog", { name: "Add a repository" })).toBeTruthy();
  });

  it("no longer offers New chat here — the nav above owns that", () => {
    renderHeader();

    expect(screen.queryByRole("button", { name: "New chat" })).toBeNull();
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
