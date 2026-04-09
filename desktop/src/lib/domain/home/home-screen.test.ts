import { describe, expect, it } from "vitest";
import type { Workspace } from "@anyharness/sdk";
import { buildHomeActionCards } from "./home-screen";

function makeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: overrides.id ?? "workspace-1",
    kind: overrides.kind ?? "worktree",
    path: overrides.path ?? "/tmp/proliferate/workspace-1",
    sourceRepoRootPath: overrides.sourceRepoRootPath ?? "/tmp/proliferate",
    sourceWorkspaceId: overrides.sourceWorkspaceId ?? "repo-1",
    gitProvider: "gitProvider" in overrides ? overrides.gitProvider : "github",
    gitOwner: "gitOwner" in overrides ? overrides.gitOwner : "proliferate-ai",
    gitRepoName: "gitRepoName" in overrides ? overrides.gitRepoName : "proliferate",
    originalBranch: "originalBranch" in overrides ? overrides.originalBranch : "main",
    currentBranch: "currentBranch" in overrides ? overrides.currentBranch : "feature/home-card",
    executionSummary: overrides.executionSummary,
    createdAt: overrides.createdAt ?? "2026-04-06T10:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-04-06T10:00:00.000Z",
  };
}

describe("buildHomeActionCards", () => {
  it("uses add-repository as the primary action when no recent workspace exists", () => {
    const cards = buildHomeActionCards({
      latestWorkspace: null,
      readyAgentCount: 1,
      agentsLoading: false,
    });

    expect(cards[0]).toMatchObject({
      id: "add-repository",
      title: "Add repository",
      description: "Choose a Git repository from disk and configure it for future sessions.",
    });
    expect(cards[1]).toMatchObject({
      id: "repository-settings",
    });
  });

  it("keeps resume first and uses add-repository as the secondary repo action when a workspace exists", () => {
    const cards = buildHomeActionCards({
      latestWorkspace: makeWorkspace(),
      readyAgentCount: 1,
      agentsLoading: false,
    });

    expect(cards[0]).toMatchObject({
      id: "resume-last-workspace",
      title: "Resume last workspace",
    });
    expect(cards[1]).toMatchObject({
      id: "add-repository",
      title: "Add another repository",
      description: "Choose a different Git repository and configure it before starting a workspace.",
    });
  });
});
