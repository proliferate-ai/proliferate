import { describe, expect, it } from "vitest";
import type { RepoRoot, Workspace } from "@anyharness/sdk";
import type { CloudWorkspaceSummary } from "@/lib/integrations/cloud/client";
import {
  buildWorkspaceCollections,
  workspaceFileTreeStateKey,
  upsertLocalWorkspaceCollections,
} from "./collections";

function makeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: overrides.id ?? "workspace-1",
    kind: overrides.kind ?? "worktree",
    repoRootId: overrides.repoRootId ?? "repo-root-1",
    path: overrides.path ?? "/tmp/repo/workspace-1",
    surface: overrides.surface ?? "standard",
    sourceRepoRootPath: overrides.sourceRepoRootPath ?? "/tmp/repo",
    sourceWorkspaceId: overrides.sourceWorkspaceId ?? "repo-1",
    gitProvider: "gitProvider" in overrides ? overrides.gitProvider : "github",
    gitOwner: "gitOwner" in overrides ? overrides.gitOwner : "proliferate-ai",
    gitRepoName: "gitRepoName" in overrides ? overrides.gitRepoName : "proliferate",
    originalBranch: "originalBranch" in overrides ? overrides.originalBranch : "main",
    currentBranch: "currentBranch" in overrides ? overrides.currentBranch : "feature/workspace-1",
    executionSummary: overrides.executionSummary,
    createdAt: overrides.createdAt ?? "2026-04-06T10:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-04-06T10:00:00.000Z",
  };
}

function makeRepoRoot(overrides: Partial<RepoRoot> = {}): RepoRoot {
  return {
    id: overrides.id ?? "repo-root-1",
    kind: overrides.kind ?? "external",
    path: overrides.path ?? "/tmp/repo",
    displayName: overrides.displayName ?? "proliferate",
    defaultBranch: overrides.defaultBranch ?? "main",
    remoteProvider: overrides.remoteProvider ?? "github",
    remoteOwner: overrides.remoteOwner ?? "proliferate-ai",
    remoteRepoName: overrides.remoteRepoName ?? "proliferate",
    remoteUrl: overrides.remoteUrl ?? null,
    createdAt: overrides.createdAt ?? "2026-04-06T09:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-04-06T09:00:00.000Z",
  };
}

function makeCloudWorkspace(): CloudWorkspaceSummary {
  return {
    id: "cloud-1",
    displayName: null,
    repo: {
      provider: "github",
      owner: "proliferate-ai",
      name: "proliferate",
      branch: "main",
      baseBranch: "main",
    },
    status: "ready",
    statusDetail: null,
    lastError: null,
    templateVersion: null,
    runtimeGeneration: 0,
    actionBlockKind: null,
    canResume: false,
    createdAt: "2026-04-06T09:00:00.000Z",
    updatedAt: "2026-04-06T09:00:00.000Z",
    postReadyPhase: "idle",
    postReadyFilesTotal: 0,
    postReadyFilesApplied: 0,
    postReadyStartedAt: null,
    postReadyCompletedAt: null,
  };
}

describe("upsertLocalWorkspaceCollections", () => {
  it("inserts a new local workspace and preserves cloud workspaces", () => {
    const existing = buildWorkspaceCollections(
      [makeWorkspace({ id: "workspace-1", updatedAt: "2026-04-06T10:00:00.000Z" })],
      [makeRepoRoot()],
      [makeCloudWorkspace()],
    );
    const inserted = makeWorkspace({
      id: "workspace-2",
      path: "/tmp/repo/workspace-2",
      currentBranch: "feature/workspace-2",
      updatedAt: "2026-04-06T11:00:00.000Z",
    });

    const next = upsertLocalWorkspaceCollections(existing, inserted);

    expect(next?.localWorkspaces.map((workspace) => workspace.id)).toEqual([
      "workspace-2",
      "workspace-1",
    ]);
    expect(next?.cloudWorkspaces).toEqual(existing.cloudWorkspaces);
    expect(next?.workspaces.map((workspace) => workspace.id)).toEqual([
      "workspace-2",
      "workspace-1",
      "cloud:cloud-1",
    ]);
  });

  it("replaces an existing local workspace in place", () => {
    const existing = buildWorkspaceCollections(
      [makeWorkspace({ id: "workspace-1", updatedAt: "2026-04-06T10:00:00.000Z" })],
      [makeRepoRoot()],
      [],
    );
    const updated = makeWorkspace({
      id: "workspace-1",
      currentBranch: "feature/updated",
      updatedAt: "2026-04-06T12:00:00.000Z",
    });

    const next = upsertLocalWorkspaceCollections(existing, updated);

    expect(next?.localWorkspaces).toHaveLength(1);
    expect(next?.localWorkspaces[0]?.currentBranch).toBe("feature/updated");
    expect(next?.workspaces[0]?.updatedAt).toBe("2026-04-06T12:00:00.000Z");
  });

  it("returns undefined when the workspace collections cache is not populated", () => {
    expect(
      upsertLocalWorkspaceCollections(undefined, makeWorkspace()),
    ).toBeUndefined();
  });
});

describe("workspaceFileTreeStateKey", () => {
  it("shares one tree key across local and synthetic cloud workspaces for the same repo", () => {
    const localWorkspace = makeWorkspace({
      id: "workspace-local",
      kind: "worktree",
      path: "/tmp/proliferate-feature",
    });
    const collections = buildWorkspaceCollections(
      [localWorkspace],
      [makeRepoRoot()],
      [makeCloudWorkspace()],
    );
    const cloudWorkspace = collections.workspaces.find((workspace) => workspace.id === "cloud:cloud-1");

    expect(cloudWorkspace).toBeDefined();
    expect(workspaceFileTreeStateKey(localWorkspace)).toBe(
      workspaceFileTreeStateKey(cloudWorkspace!),
    );
  });

  it("falls back to the local repo root when remote metadata is missing", () => {
    const workspace = makeWorkspace({
      gitProvider: null,
      gitOwner: null,
      gitRepoName: null,
      sourceRepoRootPath: "/tmp/local-only",
    });

    expect(workspaceFileTreeStateKey(workspace)).toBe("/tmp/local-only");
  });
});
