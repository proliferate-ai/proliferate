// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WorkspacesSurface } from "../src/workspaces/WorkspacesSurface";

describe("WorkspacesSurface", () => {
  beforeEach(() => {
    vi.stubGlobal("IntersectionObserver", class {
      observe() {}
      disconnect() {}
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("opens workspace view options from the toolbar control", () => {
    const onFilterChange = vi.fn();
    const onGroupChange = vi.fn();

    render(
      <WorkspacesSurface
        groups={[
          {
            id: "chat",
            label: "Chat",
            count: 1,
            items: [
              {
                id: "workspace-1",
                title: "Workspace",
                sourceKind: "web",
                sourceLabel: "Web",
                locationKind: "cloud",
                locationLabel: "Cloud",
                runtimeLocation: "cloud_sandbox",
                runtimeLocationLabel: "Cloud runtime",
                cloudAccessState: "enabled",
                cloudAccessLabel: "Cloud access enabled",
                commandability: "commandable",
                commandabilityLabel: "Ready for commands",
                statusKind: "working",
                statusLabel: "Running",
                updatedLabel: "now",
              },
            ],
          },
        ]}
        filterOptions={[
          { id: "all", label: "All", count: 1 },
          { id: "status:blocked", label: "Needs input", count: 0 },
        ]}
        selectedFilterId="all"
        groupOptions={[
          { id: "source", label: "Source" },
          { id: "status", label: "Status" },
        ]}
        selectedGroupId="source"
        summaryLabel="1 workspace"
        lastSyncedLabel="Updated now"
        onFilterChange={onFilterChange}
        onGroupChange={onGroupChange}
        onRefresh={vi.fn()}
        onGroupToggle={vi.fn()}
        onWorkspaceSelect={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Workspace view options" }));
    const filterMenu = screen.getByRole("group", { name: "Filter" });
    fireEvent.click(
      within(filterMenu).getByRole("button", { name: "Needs input" }),
    );
    expect(onFilterChange).toHaveBeenCalledWith("status:blocked");

    fireEvent.click(screen.getByRole("button", { name: "Workspace view options" }));
    const groupMenu = screen.getByRole("group", { name: "Group by" });
    fireEvent.click(within(groupMenu).getByRole("button", { name: "Status" }));
    expect(onGroupChange).toHaveBeenCalledWith("status");
  });
});
