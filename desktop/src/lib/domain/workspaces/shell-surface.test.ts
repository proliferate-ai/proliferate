import { describe, expect, it } from "vitest";
import type { Workspace } from "@anyharness/sdk";
import {
  resolveWorkspaceShellSurface,
} from "@/lib/domain/workspaces/shell-surface";
import type { PendingWorkspaceEntry } from "@/lib/domain/workspaces/pending-entry";

function makeWorkspace(overrides: Partial<Workspace>): Workspace {
  return {
    id: "workspace-1",
    kind: "local",
    repoRootId: "repo-root-1",
    path: "/tmp/repo",
    surface: "standard",
    sourceRepoRootPath: "/tmp/repo",
    lifecycleState: "active",
    cleanupState: "none",
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makePendingEntry(
  overrides: Partial<PendingWorkspaceEntry>,
): PendingWorkspaceEntry {
  return {
    attemptId: "attempt-1",
    source: "local-created",
    stage: "submitting",
    displayName: "Workspace",
    repoLabel: null,
    baseBranchName: null,
    workspaceId: null,
    request: { kind: "local", sourceRoot: "/tmp/repo" },
    originTarget: { kind: "home" },
    errorMessage: null,
    setupScript: null,
    createdAt: Date.now(),
    ...overrides,
  };
}

describe("resolveWorkspaceShellSurface", () => {
  it("uses the cowork shell for resolved cowork workspaces", () => {
    expect(resolveWorkspaceShellSurface(
      makeWorkspace({ surface: "cowork" }),
      null,
    )).toBe("cowork");
  });

  it("uses the cowork shell while a cowork thread is still pending", () => {
    expect(resolveWorkspaceShellSurface(
      null,
      makePendingEntry({ source: "cowork-created" }),
    )).toBe("cowork");
  });

  it("uses the cowork shell while a cowork launch intent is pending", () => {
    expect(resolveWorkspaceShellSurface(
      null,
      null,
      { pendingCoworkLaunch: true },
    )).toBe("cowork");
  });

  it("keeps standard workspaces on the standard shell", () => {
    expect(resolveWorkspaceShellSurface(
      makeWorkspace({ surface: "standard" }),
      makePendingEntry({ source: "local-created" }),
    )).toBe("standard");
  });
});
