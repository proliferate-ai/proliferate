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

  it("opens filter and group popovers from the toolbar controls", () => {
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
          { id: "unclaimed", label: "Unclaimed", count: 0 },
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

    fireEvent.click(screen.getByRole("button", { name: "Filter workspaces" }));
    const filterMenu = screen.getByRole("group", { name: "Workspace filters" });
    fireEvent.click(
      within(filterMenu).getByRole("button", { name: "Unclaimed, 0 workspaces" }),
    );
    expect(onFilterChange).toHaveBeenCalledWith("unclaimed");

    fireEvent.click(screen.getByRole("button", { name: "Group workspaces by Source" }));
    const groupMenu = screen.getByRole("group", { name: "Workspace grouping" });
    fireEvent.click(within(groupMenu).getByRole("button", { name: "Status" }));
    expect(onGroupChange).toHaveBeenCalledWith("status");
  });
});
