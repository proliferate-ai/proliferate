import { describe, expect, it } from "vitest";
import type { Workspace } from "@anyharness/sdk";
import {
  buildWorkspaceArrivalEvent,
  buildWorkspaceArrivalViewModel,
} from "@/lib/domain/workspaces/creation/arrival";

function makeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: "workspace-1",
    kind: "worktree",
    repoRootId: "repo-root-1",
    path: "/tmp/repo-feature",
    sourceRepoRootPath: "/tmp/repo",
    gitRepoName: "repo",
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
});
