// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { motion } from "@proliferate/design/motion";

import {
  WorkspaceInventory,
  type WorkspaceInventoryItemView,
} from "#product/components/workspace/repo-setup/WorkspaceInventory";

const { showDelayMs, minDisplayMs } = motion.loading;

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
                locationLabel: "Organization cloud",
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
            label: "Workflows",
            count: 1,
            collapsed: false,
            items: [
              workspaceItem({
                id: "workspace-2",
                title: "Nightly skill index rebuild",
                repoLabel: "proliferate-ai/proliferate",
                branchLabel: "main",
                sourceKind: "personal_automation",
                sourceLabel: "Personal workflow",
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

    const groupButton = screen.getByRole("button", { name: /Workflows/u });
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
  describe("loading vs empty split (Rung 4 / Q19)", () => {
    it("shows no empty copy while pending, before the show-delay window", () => {
      vi.useFakeTimers();
      try {
        render(<WorkspaceInventory groups={[]} loading />);

        // Inside the Class C show-delay window: nothing renders, and crucially
        // the resolved 'No workspaces' empty copy must not be shown while the
        // fetch is still in flight (the pending-vs-empty conflation bug).
        act(() => {
          vi.advanceTimersByTime(showDelayMs - 1);
        });
        expect(screen.queryByText("No workspaces")).toBeNull();

        // Even after the show-delay elapses, a pending Class C surface shows
        // nothing (treatment is null); still no empty copy.
        act(() => {
          vi.advanceTimersByTime(showDelayMs + minDisplayMs + 50);
        });
        expect(screen.queryByText("No workspaces")).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });

    it("renders the empty state only after the fetch resolves empty", () => {
      const { rerender } = render(<WorkspaceInventory groups={[]} loading />);
      expect(screen.queryByText("No workspaces")).toBeNull();

      // Fetch resolves with zero items: now, and only now, the empty state is
      // an allowed, truthful outcome.
      rerender(<WorkspaceInventory groups={[]} loading={false} />);
      expect(screen.getByText("No workspaces")).toBeTruthy();
      expect(screen.getByText("Workspaces will appear here when they are available.")).toBeTruthy();
    });

    it("renders the error state without waiting on the loading gate", () => {
      render(<WorkspaceInventory groups={[]} error />);
      expect(screen.getByRole("alert")).toBeTruthy();
      expect(screen.getByText("Could not load workspaces")).toBeTruthy();
    });
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
