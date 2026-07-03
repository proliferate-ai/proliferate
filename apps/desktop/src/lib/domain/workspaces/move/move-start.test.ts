import type { RepoRoot } from "@anyharness/sdk";
import type { RepoConfigResponse } from "@proliferate/cloud-sdk";
import { describe, expect, it } from "vitest";
import type { CloudWorkspaceSummary } from "@/lib/domain/workspaces/cloud/cloud-workspace-model";
import {
  buildLocalToCloudMoveStartRequest,
  findCollidingCloudWorkspace,
  resolveRepoConfigIdForRepoRoot,
} from "./move-start";

function repoConfig(overrides: Partial<RepoConfigResponse> = {}): RepoConfigResponse {
  return {
    id: "repo-config-1",
    gitProvider: "github",
    gitOwner: "acme",
    gitRepoName: "widgets",
    environments: [],
    ...overrides,
  };
}

function cloudWorkspace(overrides: Partial<CloudWorkspaceSummary> = {}): CloudWorkspaceSummary {
  return {
    id: "cloud-ws-1",
    displayName: "widgets",
    repo: {
      provider: "github",
      owner: "acme",
      name: "widgets",
      branch: "feature/move",
      baseBranch: "main",
    },
    status: "ready",
    workspaceStatus: "ready",
    visibility: "private",
    statusDetail: null,
    lastError: null,
    templateVersion: null,
    updatedAt: null,
    createdAt: null,
    readyAt: null,
    postReadyPhase: "done",
    postReadyFilesTotal: 0,
    postReadyFilesApplied: 0,
    postReadyStartedAt: null,
    postReadyCompletedAt: null,
    ...overrides,
  };
}

describe("resolveRepoConfigIdForRepoRoot", () => {
  it("matches a repo config by (gitOwner, gitRepoName)", () => {
    const repoRoot: Pick<RepoRoot, "remoteOwner" | "remoteRepoName"> = {
      remoteOwner: "acme",
      remoteRepoName: "widgets",
    };
    const id = resolveRepoConfigIdForRepoRoot(repoRoot, [
      repoConfig({ id: "other", gitRepoName: "gadgets" }),
      repoConfig({ id: "repo-config-1" }),
    ]);
    expect(id).toBe("repo-config-1");
  });

  it("returns null when the repo root has no remote owner/name", () => {
    expect(resolveRepoConfigIdForRepoRoot({ remoteOwner: null, remoteRepoName: null }, [repoConfig()]))
      .toBeNull();
  });

  it("returns null when nothing matches", () => {
    const repoRoot: Pick<RepoRoot, "remoteOwner" | "remoteRepoName"> = {
      remoteOwner: "acme",
      remoteRepoName: "unconfigured",
    };
    expect(resolveRepoConfigIdForRepoRoot(repoRoot, [repoConfig()])).toBeNull();
  });
});

describe("findCollidingCloudWorkspace", () => {
  it("finds a cloud workspace matching owner/name/branch", () => {
    const found = findCollidingCloudWorkspace({
      cloudWorkspaces: [cloudWorkspace({ id: "no-match", repo: { provider: "github", owner: "acme", name: "widgets", branch: "main", baseBranch: "main" } }), cloudWorkspace()],
      gitOwner: "acme",
      gitRepoName: "widgets",
      branch: "feature/move",
    });
    expect(found?.id).toBe("cloud-ws-1");
  });

  it("returns null when no cloud workspace matches", () => {
    const found = findCollidingCloudWorkspace({
      cloudWorkspaces: [cloudWorkspace()],
      gitOwner: "acme",
      gitRepoName: "widgets",
      branch: "unrelated-branch",
    });
    expect(found).toBeNull();
  });
});

describe("buildLocalToCloudMoveStartRequest", () => {
  it("builds a local source / cloud destination request", () => {
    const request = buildLocalToCloudMoveStartRequest({
      repoConfigId: "repo-config-1",
      branch: "feature/move",
      baseCommitSha: "abc123",
      desktopInstallId: "install-1",
      anyharnessWorkspaceId: "ws-1",
      idempotencyKey: "idem-1",
    });
    expect(request).toEqual({
      repoConfigId: "repo-config-1",
      branch: "feature/move",
      baseCommitSha: "abc123",
      source: { kind: "local", desktopInstallId: "install-1", anyharnessWorkspaceId: "ws-1" },
      destination: { kind: "cloud" },
      idempotencyKey: "idem-1",
    });
  });
});
