/* @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceMobilityLocationPopover } from "./WorkspaceMobilityLocationPopover";
import type { MobilityPromptState } from "@/lib/domain/workspaces/mobility/mobility-prompt";

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

describe("WorkspaceMobilityLocationPopover", () => {
  it("shows migration source and target immediately while preflight loads", () => {
    render(
      <WorkspaceMobilityLocationPopover
        prompt={makePrompt()}
        snapshot={null}
        onClose={vi.fn()}
        onPrimaryAction={vi.fn()}
      />,
    );

    expect(screen.getByText("Move target")).toBeTruthy();
    expect(screen.getByText("Destination")).toBeTruthy();
    expect(screen.getByText("Local workspace")).toBeTruthy();
    expect(screen.getByText("Cloud workspace")).toBeTruthy();
    expect(screen.getByText("Preparing")).toBeTruthy();
    expect(screen.queryByText("Gathering the details for this workspace move.")).toBeNull();
    expect(document.querySelector("[data-loading-spinner]")).toBeNull();
  });

  it("reverses the target preview for cloud-to-local moves", () => {
    render(
      <WorkspaceMobilityLocationPopover
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
        onPrimaryAction={vi.fn()}
      />,
    );

    const endpoints = screen.getAllByText(/workspace$/);
    expect(endpoints[0]?.textContent).toBe("Cloud workspace");
    expect(endpoints[1]?.textContent).toBe("Local workspace");
    expect(screen.getByText("Ready")).toBeTruthy();
  });
});
