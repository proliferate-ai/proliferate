// @vitest-environment jsdom

import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { ComposerWorkspaceActivityModel } from "@/lib/domain/workspaces/activity/composer-workspace-activity";
import { WorkspaceActivityComposerCard } from "./WorkspaceActivityComposerCard";

vi.mock("@proliferate/ui/primitives/PopoverButton", () => ({
  PopoverButton: ({
    trigger,
    align,
    children,
  }: {
    trigger: ReactNode;
    align?: string;
    children: (close: () => void) => ReactNode;
  }) => (
    <div>
      <div data-testid="popover" data-align={align}>{trigger}</div>
      {children(() => {})}
    </div>
  ),
}));

afterEach(() => {
  cleanup();
});

describe("WorkspaceActivityComposerCard", () => {
  it("renders a text-only summary and opens details from the left", () => {
    render(
      <WorkspaceActivityComposerCard
        model={activityModel()}
        pullRequestActionLabel="Create pull request"
      />,
    );

    const trigger = screen.getByRole("button", {
      name: "Workspace activity: 47 changes, PR #381 passing",
    });
    expect(within(trigger).getByText("47 changes")).toBeTruthy();
    expect(within(trigger).getByText("PR #381 passing")).toBeTruthy();
    expect(trigger.querySelector("svg")).toBeNull();
    expect(screen.getByTestId("popover").getAttribute("data-align")).toBe("start");
  });

  it("does not render a section divider after the final section", () => {
    render(
      <WorkspaceActivityComposerCard
        model={sourceControlOnlyModel()}
        pullRequestActionLabel="Create pull request"
      />,
    );

    const sourceControlSection = screen.getByText("Source control").closest("section");
    expect(sourceControlSection).toBeTruthy();
    expect(sourceControlSection?.className).not.toContain("after:");
  });
});

function activityModel(): ComposerWorkspaceActivityModel {
  return {
    facts: [
      { key: "changes", label: "47 changes", tone: "default" },
      { key: "pull-request", label: "PR #381 passing", tone: "default" },
    ],
    git: {
      branchName: "codex/workspace-activity",
      changedFiles: 47,
      stagedFiles: 0,
      unstagedFiles: 47,
      conflictedFiles: 0,
      ahead: 0,
      behind: 0,
      changeLabel: "47 changes",
      stagingLabel: "47 unstaged",
      syncLabel: null,
      pullRequestLabel: "PR #381 · Open · Checks passing",
      pushLabel: "Push",
    },
  };
}

function sourceControlOnlyModel(): ComposerWorkspaceActivityModel {
  return {
    facts: [{ key: "changes", label: "56 changes", tone: "default" }],
    git: {
      branchName: "codex/workspace-activity",
      changedFiles: 56,
      stagedFiles: 0,
      unstagedFiles: 56,
      conflictedFiles: 0,
      ahead: 0,
      behind: 0,
      changeLabel: "56 changes",
      stagingLabel: "56 unstaged",
      syncLabel: null,
      pullRequestLabel: null,
      pushLabel: "Publish branch",
    },
  };
}
