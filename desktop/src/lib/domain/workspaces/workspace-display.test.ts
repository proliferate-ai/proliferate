import type { Workspace } from "@anyharness/sdk";
import { describe, expect, it } from "vitest";
import {
  automationWorkspaceDefaultDisplayNameFromBranch,
  workspaceDefaultDisplayName,
} from "./workspace-display";

function workspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: "workspace-1",
    kind: "worktree",
    path: "/repo/.worktrees/workspace-1",
    repoRootId: "repo-1",
    surface: "standard",
    sourceRepoRootPath: "/repo",
    sourceWorkspaceId: "repo-1-workspace",
    gitProvider: "github",
    gitOwner: "proliferate-ai",
    gitRepoName: "proliferate",
    currentBranch: "feature/demo",
    originalBranch: "main",
    displayName: null,
    executionSummary: null,
    lifecycleState: "active",
    cleanupState: "none",
    origin: null,
    createdAt: "2026-04-20T00:00:00Z",
    updatedAt: "2026-04-20T00:00:00Z",
    ...overrides,
  };
}

describe("workspace display names", () => {
  it("strips deterministic automation run suffixes from default worktree names", () => {
    expect(
      workspaceDefaultDisplayName(workspace({
        currentBranch: "automation/issue-triage-fd253849c4fe4ec9",
      })),
    ).toBe("Issue triage");
  });

  it("keeps existing non-automation branch behavior", () => {
    expect(
      workspaceDefaultDisplayName(workspace({
        currentBranch: "feature/issue-triage",
      })),
    ).toBe("Issue triage");
  });

  it("handles malformed automation-like branches without crashing", () => {
    expect(automationWorkspaceDefaultDisplayNameFromBranch("automation/")).toBeNull();
    expect(automationWorkspaceDefaultDisplayNameFromBranch("automation/issue-triage")).toBeNull();
    expect(
      workspaceDefaultDisplayName(workspace({
        currentBranch: "automation/issue-triage",
      })),
    ).toBe("Issue triage");
  });
});
