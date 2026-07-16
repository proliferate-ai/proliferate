import type { CloudWorkspaceSummary } from "@proliferate/cloud-sdk";
import { describe, expect, it } from "vitest";

import {
  buildRecentWorkItems,
} from "./recent-work-items";
import { cloudWorkItemForWorkspace } from "./cloud-work-items";
import {
  isRepositoryWorktree,
  isScratchWorkspace,
  workspaceBackingKind,
  workspaceBranchLabel,
  workspaceDisplayTitle,
  workspaceRepoLabel,
  workspaceRepoRef,
} from "./backing-kind";

function workspace(overrides: Partial<CloudWorkspaceSummary> = {}): CloudWorkspaceSummary {
  return {
    id: "workspace",
    displayName: "Workspace",
    repo: {
      provider: "github",
      owner: "proliferate-ai",
      name: "proliferate",
      branch: "feature-x",
      baseBranch: "main",
    },
    status: "ready",
    workspaceStatus: "ready",
    statusDetail: null,
    lastError: null,
    templateVersion: null,
    updatedAt: "2026-07-15T11:30:00Z",
    createdAt: "2026-07-15T10:00:00Z",
    readyAt: "2026-07-15T10:00:00Z",
    postReadyPhase: "complete",
    postReadyFilesTotal: 0,
    postReadyFilesApplied: 0,
    postReadyStartedAt: null,
    postReadyCompletedAt: null,
    visibility: "private",
    allowedAgentKinds: [],
    readyAgentKinds: [],
    ...overrides,
  } as CloudWorkspaceSummary;
}

const scratch = () =>
  workspace({
    id: "run-1",
    workspaceKind: "scratch",
    displayName: "Workflow run run-1",
    repo: null,
    repoEnvironmentId: null,
  });

describe("workspace backing-kind derivation", () => {
  it("treats absent workspaceKind as a repository worktree", () => {
    const ws = workspace();
    expect(ws.workspaceKind).toBeUndefined();
    expect(workspaceBackingKind(ws)).toBe("repositoryWorktree");
    expect(isRepositoryWorktree(ws)).toBe(true);
    expect(isScratchWorkspace(ws)).toBe(false);
    expect(workspaceRepoRef(ws)).toEqual(ws.repo);
    expect(workspaceRepoLabel(ws)).toBe("proliferate-ai/proliferate");
    expect(workspaceBranchLabel(ws)).toBe("feature-x");
  });

  it("never fabricates repository data for scratch workspaces", () => {
    const ws = scratch();
    expect(workspaceBackingKind(ws)).toBe("scratch");
    expect(isScratchWorkspace(ws)).toBe(true);
    expect(workspaceRepoRef(ws)).toBeNull();
    expect(workspaceRepoLabel(ws)).toBeNull();
    // Scratch workspaces default to the main branch, no repo dereference.
    expect(workspaceBranchLabel(ws)).toBe("main");
    expect(workspaceDisplayTitle(ws)).toBe("Workflow run run-1");
  });

  it("produces cloud work items for scratch workspaces without throwing", () => {
    const item = cloudWorkItemForWorkspace(scratch(), { nowMs: Date.parse("2026-07-15T12:00:00Z") });
    expect(item.repoLabel).toBe("");
    expect(item.branchLabel).toBe("main");
    expect(item.title).toBe("Workflow run run-1");
  });

  it("produces recent work items for scratch workspaces without throwing", () => {
    const rows = buildRecentWorkItems([scratch()], {
      nowMs: Date.parse("2026-07-15T12:00:00Z"),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.title).toBe("Workflow run run-1");
    expect(rows[0]?.repoLabel).toBe("");
    expect(rows[0]?.branchLabel).toBe("main");
  });
});
