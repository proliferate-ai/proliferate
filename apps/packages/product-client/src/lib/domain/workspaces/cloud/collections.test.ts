import { describe, expect, it } from "vitest";
import type { RepoRoot, Workspace } from "@anyharness/sdk";
import type { CloudWorkspaceSummary } from "#product/lib/domain/workspaces/cloud/cloud-workspace-model";
import {
  buildWorkspaceCollections,
  workspaceFileTreeStateKey,
  upsertCloudWorkspaceCollections,
  upsertLocalWorkspaceCollections,
  workspaceCollectionsNeedActivityRefresh,
} from "#product/lib/domain/workspaces/cloud/collections";

function makeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    availability: "available",
    id: overrides.id ?? "workspace-1",
    kind: overrides.kind ?? "worktree",
    repoRootId: overrides.repoRootId ?? "repo-root-1",
    path: overrides.path ?? "/tmp/repo/workspace-1",
    surface: overrides.surface ?? "standard",
    originalBranch: "originalBranch" in overrides ? overrides.originalBranch : "main",
    currentBranch: "currentBranch" in overrides ? overrides.currentBranch : "feature/workspace-1",
    executionSummary: overrides.executionSummary,
    lifecycleState: overrides.lifecycleState ?? "active",
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
    },
    statusDetail: overrides.statusDetail ?? null,
    lastError: overrides.lastError ?? null,
    templateVersion: overrides.templateVersion ?? null,
    createdAt: overrides.createdAt ?? "2026-04-06T09:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-04-06T09:00:00.000Z",
    readyAt: "readyAt" in overrides
      ? overrides.readyAt ?? null
      : (overrides.status ?? "ready") === "ready" || (overrides.status ?? "ready") === "error"
        ? "2026-04-06T09:00:00.000Z"
        : null,
    postReadyPhase: overrides.postReadyPhase ?? "idle",
    postReadyFilesTotal: overrides.postReadyFilesTotal ?? 0,
    postReadyFilesApplied: overrides.postReadyFilesApplied ?? 0,
    postReadyStartedAt: overrides.postReadyStartedAt ?? null,
    postReadyCompletedAt: overrides.postReadyCompletedAt ?? null,
    visibility: overrides.visibility ?? "private",
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

  it("keeps same-path local workspaces distinct by workspace id", () => {
    const existing = buildWorkspaceCollections(
      [makeWorkspace({
        id: "workspace-1",
        path: "/tmp/repo",
        updatedAt: "2026-04-06T10:00:00.000Z",
      })],
      [makeRepoRoot()],
      [],
    );
    const inserted = makeWorkspace({
      id: "workspace-2",
      path: "/tmp/repo",
      updatedAt: "2026-04-06T11:00:00.000Z",
    });

    const next = upsertLocalWorkspaceCollections(existing, inserted);

    expect(next?.localWorkspaces.map((workspace) => workspace.id)).toEqual([
      "workspace-2",
      "workspace-1",
    ]);
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

    // Cloud culling (PRO-10, FR-2): every collection built at this seam has its
    // cloud rows removed, so an upserted cloud workspace never surfaces while
    // local rows are preserved. (Pre-cull, cloudWorkspaces held ["cloud-2",
    // "cloud-1"].)
    expect(next?.localWorkspaces.map((workspace) => workspace.id)).toEqual(["workspace-1"]);
    expect(next?.cloudWorkspaces).toEqual([]);
    expect(next?.workspaces.map((workspace) => workspace.id)).toEqual(["workspace-1"]);
  });

  it("keeps cloud workspaces culled when a snapshot is replaced", () => {
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

    // Cloud culling (PRO-10, FR-2): the row is never surfaced regardless of its
    // status. (Pre-cull, this asserted the "ready" snapshot replaced "pending".)
    expect(next?.cloudWorkspaces).toEqual([]);
  });

  it("returns undefined when the workspace collections cache is not populated", () => {
    expect(
      upsertCloudWorkspaceCollections(undefined, makeCloudWorkspace()),
    ).toBeUndefined();
  });
});

describe("buildWorkspaceCollections", () => {
  it("keeps only active rows in the listed collections and archived rows in allWorkspaces", () => {
    const active = makeWorkspace({ id: "workspace-active" });
    const archivedComplete = makeWorkspace({
      id: "workspace-archived-complete",
      lifecycleState: "archived",
      updatedAt: "2026-04-06T11:00:00.000Z",
    });
    const archivedFailed = makeWorkspace({
      id: "workspace-archived-failed",
      lifecycleState: "archived",
      updatedAt: "2026-04-06T12:00:00.000Z",
    });

    const collections = buildWorkspaceCollections([
      active,
      archivedComplete,
      archivedFailed,
    ]);

    expect(collections.localWorkspaces.map((workspace) => workspace.id)).toEqual([
      "workspace-active",
    ]);
    expect(collections.workspaces.map((workspace) => workspace.id)).toEqual([
      "workspace-active",
    ]);
    expect(collections.allWorkspaces.map((workspace) => workspace.id)).toEqual([
      "workspace-archived-failed",
      "workspace-archived-complete",
      "workspace-active",
    ]);
  });

  it("does not request activity refresh for archived rows", () => {
    const collections = buildWorkspaceCollections([
      makeWorkspace({
        lifecycleState: "archived",
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

    expect(workspaceCollectionsNeedActivityRefresh(collections)).toBe(false);
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

  it("does not keep polling for local workspaces awaiting interaction", () => {
    const collections = buildWorkspaceCollections([
      makeWorkspace({
        executionSummary: {
          phase: "awaiting_interaction",
          totalSessionCount: 1,
          liveSessionCount: 1,
          runningCount: 0,
          awaitingInteractionCount: 1,
          idleCount: 0,
          erroredCount: 0,
        },
      }),
    ]);

    expect(workspaceCollectionsNeedActivityRefresh(collections)).toBe(false);
  });

  // Cloud culling (PRO-10, FR-2): cloud rows are removed at this seam, so cloud
  // post-ready setup no longer drives an activity refresh. (Pre-cull, a "ready"
  // cloud workspace in "starting_setup" requested a refresh; now there is no
  // cloud row to poll.)
  it("does not request refresh for a culled cloud post-ready setup", () => {
    const collections = buildWorkspaceCollections(
      [],
      [],
      [makeCloudWorkspace({ status: "ready", postReadyPhase: "starting_setup" })],
    );

    expect(workspaceCollectionsNeedActivityRefresh(collections)).toBe(false);
  });

  it("stops refreshing after cloud post-ready work completes", () => {
    const collections = buildWorkspaceCollections(
      [],
      [],
      [makeCloudWorkspace({ status: "ready", postReadyPhase: "completed" })],
    );

    expect(workspaceCollectionsNeedActivityRefresh(collections)).toBe(false);
  });
});

describe("workspaceFileTreeStateKey", () => {
  it("uses the workspace repo root id as the local tree key", () => {
    const localWorkspace = makeWorkspace({
      id: "workspace-local",
      kind: "worktree",
      path: "/tmp/proliferate-feature",
    });

    expect(workspaceFileTreeStateKey(localWorkspace)).toBe("repo-root-1");
  });

  it("falls back to the workspace path when the repo root id is unavailable", () => {
    const workspace = makeWorkspace({
      repoRootId: "",
      path: "/tmp/local-only/workspace",
    });

    expect(workspaceFileTreeStateKey(workspace)).toBe("/tmp/local-only/workspace");
  });
});
