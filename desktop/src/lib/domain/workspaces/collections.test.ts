import { describe, expect, it } from "vitest";
import type { RepoRoot, Workspace } from "@anyharness/sdk";
import type { CloudWorkspaceSummary } from "@/lib/integrations/cloud/client";
import {
  buildWorkspaceCollections,
  cloudWorkspaceGroupKey,
  workspaceFileTreeStateKey,
  upsertCloudWorkspaceCollections,
  upsertLocalWorkspaceCollections,
  workspaceCollectionsNeedActivityRefresh,
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
    lifecycleState: overrides.lifecycleState ?? "active",
    cleanupState: overrides.cleanupState ?? "none",
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

function makeCloudWorkspace(overrides: Partial<CloudWorkspaceSummary> = {}): CloudWorkspaceSummary {
  return {
    id: overrides.id ?? "cloud-1",
    displayName: overrides.displayName ?? null,
    repo: {
      provider: "github",
      owner: "proliferate-ai",
      name: "proliferate",
      branch: overrides.repo?.branch ?? "main",
      baseBranch: "main",
    },
    status: overrides.status ?? "ready",
    workspaceStatus: overrides.workspaceStatus ?? overrides.status ?? "ready",
    runtime: overrides.runtime ?? {
      environmentId: null,
      status: "running",
      generation: 0,
      actionBlockKind: null,
      actionBlockReason: null,
    },
    statusDetail: overrides.statusDetail ?? null,
    lastError: overrides.lastError ?? null,
    templateVersion: overrides.templateVersion ?? null,
    actionBlockKind: overrides.actionBlockKind ?? null,
    createdAt: overrides.createdAt ?? "2026-04-06T09:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-04-06T09:00:00.000Z",
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

describe("upsertCloudWorkspaceCollections", () => {
  it("inserts a new cloud workspace and preserves local workspaces", () => {
    const existing = buildWorkspaceCollections(
      [makeWorkspace({ id: "workspace-1" })],
      [makeRepoRoot()],
      [makeCloudWorkspace({ id: "cloud-1", updatedAt: "2026-04-06T09:00:00.000Z" })],
    );
    const inserted = makeCloudWorkspace({
      id: "cloud-2",
      repo: {
        provider: "github",
        owner: "proliferate-ai",
        name: "proliferate",
        branch: "feature/cloud-2",
        baseBranch: "main",
      },
      status: "pending",
      workspaceStatus: "pending",
      updatedAt: "2026-04-06T11:00:00.000Z",
    });

    const next = upsertCloudWorkspaceCollections(existing, inserted);

    expect(next?.localWorkspaces.map((workspace) => workspace.id)).toEqual(["workspace-1"]);
    expect(next?.cloudWorkspaces.map((workspace) => workspace.id)).toEqual([
      "cloud-2",
      "cloud-1",
    ]);
    expect(next?.workspaces.map((workspace) => workspace.id)).toEqual(["workspace-1"]);
  });

  it("replaces an existing cloud workspace snapshot", () => {
    const existing = buildWorkspaceCollections(
      [makeWorkspace({ id: "workspace-1" })],
      [makeRepoRoot()],
      [makeCloudWorkspace({ id: "cloud-1", status: "pending", workspaceStatus: "pending" })],
    );
    const updated = makeCloudWorkspace({
      id: "cloud-1",
      status: "ready",
      workspaceStatus: "ready",
      updatedAt: "2026-04-06T12:00:00.000Z",
    });

    const next = upsertCloudWorkspaceCollections(existing, updated);

    expect(next?.cloudWorkspaces).toHaveLength(1);
    expect(next?.cloudWorkspaces[0]?.status).toBe("ready");
    expect(next?.cloudWorkspaces[0]?.updatedAt).toBe("2026-04-06T12:00:00.000Z");
  });

  it("returns undefined when the workspace collections cache is not populated", () => {
    expect(
      upsertCloudWorkspaceCollections(undefined, makeCloudWorkspace()),
    ).toBeUndefined();
  });
});

describe("workspaceCollectionsNeedActivityRefresh", () => {
  it("requests refresh while a local workspace execution summary is active", () => {
    const collections = buildWorkspaceCollections([
      makeWorkspace({
        executionSummary: {
          phase: "running",
          totalSessionCount: 1,
          liveSessionCount: 1,
          runningCount: 1,
          awaitingInteractionCount: 0,
          idleCount: 0,
          erroredCount: 0,
        },
      }),
    ]);

    expect(workspaceCollectionsNeedActivityRefresh(collections)).toBe(true);
  });

  it("stops refreshing once all local workspace summaries are idle", () => {
    const collections = buildWorkspaceCollections([
      makeWorkspace({
        executionSummary: {
          phase: "idle",
          totalSessionCount: 1,
          liveSessionCount: 1,
          runningCount: 0,
          awaitingInteractionCount: 0,
          idleCount: 1,
          erroredCount: 0,
        },
      }),
    ]);

    expect(workspaceCollectionsNeedActivityRefresh(collections)).toBe(false);
  });
});

describe("workspaceFileTreeStateKey", () => {
  it("uses the same repo grouping inputs as cloud workspace grouping", () => {
    const localWorkspace = makeWorkspace({
      id: "workspace-local",
      kind: "worktree",
      path: "/tmp/proliferate-feature",
    });
    const cloudWorkspace = makeCloudWorkspace();

    expect(workspaceFileTreeStateKey(localWorkspace)).toBe(cloudWorkspaceGroupKey(cloudWorkspace));
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
