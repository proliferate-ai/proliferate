// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  WorkspaceInventory,
  type WorkspaceInventoryItemView,
} from "../src/workspaces/WorkspaceInventory";

describe("WorkspaceInventory", () => {
  afterEach(cleanup);

  it("renders source-grouped rows without requiring interactive handlers", () => {
    render(
      <WorkspaceInventory
        ariaLabel="Team workspaces"
        groups={[
          {
            id: "slack",
            label: "Slack",
            count: 1,
            collapsed: true,
            items: [
              workspaceItem({
                id: "workspace-1",
                title: "Investigate worker claim",
                repoLabel: "proliferate-ai/proliferate",
                branchLabel: "fix/claim-null",
                sourceKind: "slack",
                sourceLabel: "Slack",
                locationKind: "managed_shared",
                locationLabel: "Shared cloud",
                statusKind: "blocked",
                statusLabel: "Blocked",
                ownerLabel: "Unclaimed",
                exposureLabel: "Live",
                updatedLabel: "2m",
              }),
            ],
          },
        ]}
      />,
    );

    expect(screen.getByRole("region", { name: "Team workspaces" })).toBeTruthy();
    expect(screen.getAllByText("Slack").length).toBeGreaterThan(0);
    expect(screen.getByText("Investigate worker claim")).toBeTruthy();
    expect(screen.getByText(/proliferate-ai\/proliferate/u)).toBeTruthy();
    expect(screen.getByText(/Ready for commands/u)).toBeTruthy();
    expect(screen.getByText("fix/claim-null")).toBeTruthy();
  });

  it("emits group and workspace selection from interactive rows", () => {
    const onGroupToggle = vi.fn();
    const onWorkspaceSelect = vi.fn();

    render(
      <WorkspaceInventory
        groups={[
          {
            id: "automation",
            label: "Automations",
            count: 1,
            collapsed: false,
            items: [
              workspaceItem({
                id: "workspace-2",
                title: "Nightly skill index rebuild",
                repoLabel: "proliferate-ai/proliferate",
                branchLabel: "main",
                sourceKind: "personal_automation",
                sourceLabel: "Personal automation",
                locationKind: "managed_personal",
                locationLabel: "Personal cloud",
                statusKind: "working",
                statusLabel: "Running",
                ownerLabel: "Mine",
                sessionLabel: "Rebuild skills",
                updatedLabel: "now",
              }),
            ],
          },
        ]}
        onGroupToggle={onGroupToggle}
        onWorkspaceSelect={onWorkspaceSelect}
      />,
    );

    const groupButton = screen.getByRole("button", { name: /Automations/u });
    const contentId = groupButton.getAttribute("aria-controls");
    const content = contentId ? document.getElementById(contentId) : null;

    expect(groupButton.getAttribute("aria-expanded")).toBe("true");
    expect(content).toBeTruthy();
    expect(content?.hidden).toBe(false);

    fireEvent.click(groupButton);
    expect(onGroupToggle).toHaveBeenCalledWith("automation");

    const workspaceButton = screen.getByRole("button", { name: /Nightly skill index rebuild/u });
    expect(workspaceButton.getAttribute("aria-label")).toContain("status Running");
    expect(workspaceButton.getAttribute("aria-label")).toContain("runtime Cloud runtime");

    fireEvent.click(workspaceButton);
    expect(onWorkspaceSelect).toHaveBeenCalledWith("workspace-2");
  });

  it("hides collapsed group rows when a toggle handler is provided", () => {
    render(
      <WorkspaceInventory
        groups={[
          {
            id: "api",
            label: "API",
            count: 1,
            collapsed: true,
            items: [
              workspaceItem({
                id: "workspace-3",
                title: "Hidden dispatch workspace",
                sourceKind: "api",
                sourceLabel: "API",
              }),
            ],
          },
        ]}
        onGroupToggle={vi.fn()}
        onWorkspaceSelect={vi.fn()}
      />,
    );

    const groupButton = screen.getByRole("button", { name: /API/u });
    const contentId = groupButton.getAttribute("aria-controls");
    const content = contentId ? document.getElementById(contentId) : null;

    expect(groupButton.getAttribute("aria-expanded")).toBe("false");
    expect(content).toBeTruthy();
    expect(content?.hidden).toBe(true);
    expect(screen.queryByRole("button", { name: /Hidden dispatch workspace/u })).toBeNull();
    expect(screen.queryByText("Hidden dispatch workspace")).toBeNull();
  });
});

function workspaceItem(
  overrides: Partial<WorkspaceInventoryItemView> = {},
): WorkspaceInventoryItemView {
  return {
    id: "workspace",
    title: "Workspace",
    repoLabel: "proliferate-ai/proliferate",
    branchLabel: "main",
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
    statusKind: "waiting",
    statusLabel: "Waiting",
    ...overrides,
  };
}
