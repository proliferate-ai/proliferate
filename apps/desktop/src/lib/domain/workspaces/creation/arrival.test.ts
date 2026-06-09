import { describe, expect, it } from "vitest";
import type { Workspace } from "@anyharness/sdk";
import {
  buildPendingWorkspaceArrivalViewModel,
  buildWorkspaceArrivalEvent,
  buildWorkspaceArrivalViewModel,
} from "@/lib/domain/workspaces/creation/arrival";
import { buildSubmittingPendingWorkspaceEntry } from "@/lib/domain/workspaces/creation/pending-entry";

function makeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: "workspace-1",
    kind: "worktree",
    repoRootId: "repo-root-1",
    path: "/tmp/repo-feature",
    currentBranch: "feature",
    originalBranch: "main",
    surface: "standard",
    lifecycleState: "active",
    cleanupState: "none",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("workspace arrival view model", () => {
  it("does not label cowork-created worktrees as new worktrees", () => {
    const view = buildWorkspaceArrivalViewModel({
      event: buildWorkspaceArrivalEvent({
        workspaceId: "workspace-1",
        source: "cowork-created",
      }),
      workspace: makeWorkspace({ surface: "cowork" }),
      configuredSetupScript: "",
    });

    expect(view.badgeLabel).toBe("Workspace");
  });

  it("keeps normal worktree-created arrivals labeled as new worktrees", () => {
    const view = buildWorkspaceArrivalViewModel({
      event: buildWorkspaceArrivalEvent({
        workspaceId: "workspace-1",
        source: "worktree-created",
      }),
      workspace: makeWorkspace(),
      configuredSetupScript: "",
    });

    expect(view.badgeLabel).toBe("New worktree");
  });

  it("keeps generated worktree names stable after materialization", () => {
    const view = buildWorkspaceArrivalViewModel({
      event: buildWorkspaceArrivalEvent({
        workspaceId: "workspace-1",
        source: "worktree-created",
        baseBranchName: "main",
      }),
      workspace: makeWorkspace({
        path: "/Users/pablo/.proliferate/worktrees/landing/gulch",
        currentBranch: "gulch",
        displayName: undefined,
      }),
      configuredSetupScript: "",
      repoName: "proliferate",
    });

    expect(view.title).toBe("gulch");
    expect(view.workspaceName).toBe("gulch");
    expect(view.subtitle).toBe("Created in proliferate from main");
    if (view.kind === "worktree") {
      expect(view.branchName).toBe("gulch");
    }
  });

  it("projects pending worktrees with the final arrival copy before materialization", () => {
    const view = buildPendingWorkspaceArrivalViewModel({
      entry: buildSubmittingPendingWorkspaceEntry({
        attemptId: "attempt-1",
        selectedWorkspaceId: null,
        source: "worktree-created",
        displayName: "landing",
        repoLabel: "proliferate",
        baseBranchName: "main",
        request: {
          kind: "worktree",
          input: {
            repoRootId: "repo-root-1",
            workspaceName: "landing",
            branchName: "pablo/landing",
            baseBranch: "main",
            targetPath: "/Users/pablo/.proliferate/worktrees/proliferate/landing",
          },
        },
      }),
      configuredSetupScript: "",
    });

    expect(view).toMatchObject({
      badgeLabel: "New worktree",
      title: "landing",
      subtitle: "Created in proliferate from main",
      setupStatusLabel: "Optional",
      setupSummary: "No setup script configured yet",
    });
  });
});
