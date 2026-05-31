/* @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceMobilityLocationPopover } from "./WorkspaceMobilityLocationPopover";
import type { MobilityPromptState } from "@/lib/domain/workspaces/mobility/mobility-prompt";
import type { WorkspaceMobilityDestinationOption } from "@/lib/domain/workspaces/mobility/mobility-destinations";

afterEach(() => {
  cleanup();
});

function makePrompt(overrides: Partial<MobilityPromptState> = {}): MobilityPromptState {
  return {
    variant: "loading",
    direction: "local_to_cloud",
    headline: "Checking local worktree move",
    body: "Gathering the details for this workspace move.",
    helper: null,
    actionLabel: null,
    warning: null,
    blocker: null,
    primaryActionKind: null,
    ...overrides,
  };
}

const DESTINATIONS: WorkspaceMobilityDestinationOption[] = [{
  id: "cloud_workspace",
  kind: "cloud_workspace",
  label: "Cloud workspace",
  detail: "Move this workspace to a personal cloud sandbox.",
  disabledReason: null,
  direction: "local_to_cloud",
}, {
  id: "ssh:ssh-target-1",
  kind: "ssh_target",
  label: "Pop OS",
  detail: "Personal SSH target - online",
  disabledReason: "SSH workspace moves are not wired yet.",
  direction: null,
}];

describe("WorkspaceMobilityLocationPopover", () => {
  it("shows destination options before preparing preflight", () => {
    render(
      <WorkspaceMobilityLocationPopover
        destinationOptions={DESTINATIONS}
        selectedDestinationId={null}
        prompt={null}
        snapshot={null}
        onClose={vi.fn()}
        onSelectDestination={vi.fn()}
        onPrimaryAction={vi.fn()}
      />,
    );

    expect(screen.getByText("Move to")).toBeTruthy();
    expect(screen.getByText("Cloud workspace")).toBeTruthy();
    expect(screen.getByText("Pop OS")).toBeTruthy();
    const sshButton = screen.getByRole("button", { name: "Pop OS" });
    expect((sshButton as HTMLButtonElement).disabled).toBe(true);
    expect(sshButton.getAttribute("title")).toBe("SSH workspace moves are not wired yet.");
  });

  it("shows a compact selected destination while preflight loads", () => {
    render(
      <WorkspaceMobilityLocationPopover
        destinationOptions={DESTINATIONS}
        selectedDestinationId="cloud_workspace"
        prompt={makePrompt()}
        snapshot={null}
        onClose={vi.fn()}
        onSelectDestination={vi.fn()}
        onPrimaryAction={vi.fn()}
      />,
    );

    expect(screen.getByText("Move to")).toBeTruthy();
    expect(screen.getByText("Cloud workspace")).toBeTruthy();
    expect(screen.getByText("Preparing")).toBeTruthy();
    expect(screen.queryByText("Move target")).toBeNull();
    expect(screen.queryByText("Local workspace")).toBeNull();
    expect(screen.queryByText("Gathering the details for this workspace move.")).toBeNull();
  });

  it("shows the selected destination and prompt for cloud-to-local moves", () => {
    render(
      <WorkspaceMobilityLocationPopover
        destinationOptions={[{
          id: "local_workspace",
          kind: "local_workspace",
          label: "Local workspace",
          detail: "Bring this workspace back to your local repo.",
          disabledReason: null,
          direction: "cloud_to_local",
        }]}
        selectedDestinationId="local_workspace"
        prompt={makePrompt({
          variant: "actionable",
          direction: "cloud_to_local",
          headline: "Bring back local",
          body: "Move this workspace from cloud back to your local machine.",
          actionLabel: "Bring back local",
          primaryActionKind: "confirm_move",
        })}
        snapshot={null}
        onClose={vi.fn()}
        onSelectDestination={vi.fn()}
        onPrimaryAction={vi.fn()}
      />,
    );

    expect(screen.getByText("Move to")).toBeTruthy();
    expect(screen.getByText("Local workspace")).toBeTruthy();
    expect(screen.getAllByText("Bring back local")).toHaveLength(2);
    expect(screen.getByText("Move this workspace from cloud back to your local machine.")).toBeTruthy();
    expect(screen.queryByText("Move target")).toBeNull();
  });

  it("locks navigation and cancel while the primary action is pending", () => {
    render(
      <WorkspaceMobilityLocationPopover
        destinationOptions={DESTINATIONS}
        selectedDestinationId="cloud_workspace"
        prompt={makePrompt({
          variant: "blocked",
          headline: "Push branch before moving",
          body: "This branch has unpublished commits.",
          actionLabel: "Push and move",
          primaryActionKind: "push_commits",
        })}
        snapshot={null}
        isActionPending
        onClose={vi.fn()}
        onSelectDestination={vi.fn()}
        onBackToDestinations={vi.fn()}
        onPrimaryAction={vi.fn()}
      />,
    );

    expect((screen.getByRole("button", { name: "Cloud workspace" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Push and move" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
