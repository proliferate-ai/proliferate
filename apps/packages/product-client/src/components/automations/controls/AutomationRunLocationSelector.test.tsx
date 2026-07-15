/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AutomationRunLocationSelector } from "#product/components/automations/controls/AutomationRunLocationSelector";
import type {
  AutomationTargetGroup,
  AutomationTargetSelection,
} from "#product/lib/domain/automations/target/selection";

const localTarget: AutomationTargetSelection = {
  executionTarget: "local",
  gitOwner: "proliferate-ai",
  gitRepoName: "proliferate",
};

const cloudTarget: AutomationTargetSelection = {
  executionTarget: "cloud",
  gitOwner: "proliferate-ai",
  gitRepoName: "proliferate",
};

const personalGroups: AutomationTargetGroup[] = [{
  repoKey: "proliferate-ai/proliferate",
  repoLabel: "Proliferate",
  gitOwner: "proliferate-ai",
  gitRepoName: "proliferate",
  rows: [{
    kind: "target",
    id: "local",
    repoKey: "proliferate-ai/proliferate",
    repoLabel: "Proliferate",
    label: "Local worktree",
    description: "Run locally.",
    target: localTarget,
    disabledReason: null,
    selected: true,
  }],
}];

const teamGroups: AutomationTargetGroup[] = [{
  repoKey: "proliferate-ai/proliferate",
  repoLabel: "Proliferate",
  gitOwner: "proliferate-ai",
  gitRepoName: "proliferate",
  rows: [{
    kind: "target",
    id: "cloud",
    repoKey: "proliferate-ai/proliferate",
    repoLabel: "Proliferate",
    label: "Organization cloud",
    description: "Run in organization cloud.",
    target: cloudTarget,
    disabledReason: null,
    selected: false,
  }],
}];

const ownerOptions = [{
  value: "personal" as const,
  label: "Personal",
  description: "Run personally.",
}, {
  value: "organization" as const,
  label: "Team",
  description: "Run with the team.",
  disabledReason: null,
}];

afterEach(() => {
  cleanup();
});

describe("AutomationRunLocationSelector", () => {
  it("renders as a compact picker instead of the old card layout", () => {
    render(
      <AutomationRunLocationSelector
        ownerScope="personal"
        canChangeOwner
        ownerOptions={ownerOptions}
        personalGroups={personalGroups}
        teamGroups={teamGroups}
        isLoading={false}
        disabledReason={null}
        onSelectOwner={vi.fn()}
        onSelectTarget={vi.fn()}
        onConfigureCloud={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", {
      name: "Run location: Local worktree Proliferate",
    })).toBeTruthy();
    expect(screen.queryByText("Choose where this automation runs.")).toBeNull();
    expect(screen.queryByLabelText("Filter run locations")).toBeNull();
  });

  it("selects team through the organization cloud option", () => {
    const onSelectOwner = vi.fn();
    const onSelectTarget = vi.fn();
    render(
      <AutomationRunLocationSelector
        ownerScope="personal"
        canChangeOwner
        ownerOptions={ownerOptions}
        personalGroups={personalGroups}
        teamGroups={teamGroups}
        isLoading={false}
        disabledReason={null}
        onSelectOwner={onSelectOwner}
        onSelectTarget={onSelectTarget}
        onConfigureCloud={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", {
      name: "Run location: Local worktree Proliferate",
    }));
    expect(screen.getByText("Run as")).toBeTruthy();
    expect(screen.getByText("Personal")).toBeTruthy();
    expect(screen.getByText("Team")).toBeTruthy();
    expect(screen.getByText("Personal workspace")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Team/ }));
    expect(onSelectOwner).toHaveBeenCalledWith("organization");
    expect(onSelectTarget).toHaveBeenCalledWith(cloudTarget);
  });

  it("shows team target rows when the organization scope is active", () => {
    const onSelectOwner = vi.fn();
    const onSelectTarget = vi.fn();
    render(
      <AutomationRunLocationSelector
        ownerScope="organization"
        canChangeOwner
        ownerOptions={ownerOptions}
        personalGroups={personalGroups}
        teamGroups={teamGroups}
        isLoading={false}
        disabledReason={null}
        onSelectOwner={onSelectOwner}
        onSelectTarget={onSelectTarget}
        onConfigureCloud={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", {
      name: "Run location: Team Organization cloud",
    }));
    // "Organization cloud" renders several times (trigger label, Team owner
    // option detail, section header, and the team target row), so target the
    // team target row by its exact accessible name to keep the single-match intent.
    const popover = within(screen.getByRole("dialog"));
    // The row's accessible name leads with "Organization cloud" (then the repo
    // label); the Team owner option is "Team Organization cloud", so anchor to
    // the start to select the row uniquely.
    const teamRow = popover.getByRole("button", { name: /^Organization cloud/ });
    expect(teamRow).toBeTruthy();

    fireEvent.click(teamRow);
    expect(onSelectOwner).toHaveBeenCalledWith("organization");
    expect(onSelectTarget).toHaveBeenCalledWith(cloudTarget);
  });
});
