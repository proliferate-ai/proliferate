import type { RepoRoot } from "@anyharness/sdk";
import type { RepoConfigResponse, StartWorkspaceMoveRequest } from "@proliferate/cloud-sdk";
import { cloudRepositoryKey } from "@/lib/domain/settings/repositories";
import type { CloudWorkspaceSummary } from "@/lib/domain/workspaces/cloud/cloud-workspace-model";

// Pure helpers for building the local->cloud `StartWorkspaceMoveRequest` (spec section
// 5.2/5.3) and for the collision decision (spec section 2, "Collision"): resolving the
// server-side repo identity from what Desktop already has cached, and -- since the SDK's
// 409 error doesn't carry the colliding workspace's id (`ProliferateClientError` only
// exposes `message`/`status`/`code`) -- finding it from the already-fetched workspace
// collections cache instead of a second round trip.

/**
 * `StartWorkspaceMoveRequest.repoConfigId` identifies the repo server-side; Desktop only
 * has the repo by (gitOwner, gitRepoName) locally. Requires the repo to already be
 * connected to Proliferate Cloud (a `RepoConfigResponse` row exists) -- true by
 * construction once a collision is possible, and gated earlier by the entry points
 * otherwise (a repo with no cloud config can't have a colliding cloud workspace).
 */
export function resolveRepoConfigIdForRepoRoot(
  repoRoot: Pick<RepoRoot, "remoteOwner" | "remoteRepoName"> | null | undefined,
  repoConfigs: readonly RepoConfigResponse[],
): string | null {
  const gitOwner = repoRoot?.remoteOwner?.trim();
  const gitRepoName = repoRoot?.remoteRepoName?.trim();
  if (!gitOwner || !gitRepoName) {
    return null;
  }
  const key = cloudRepositoryKey(gitOwner, gitRepoName);
  return repoConfigs.find((config) =>
    cloudRepositoryKey(config.gitOwner, config.gitRepoName) === key
  )?.id ?? null;
}

/**
 * Finds the cloud workspace a `cloud_workspace_exists` collision (409) refers to, by
 * matching the move's own (gitOwner, gitRepoName, branch) against the already-cached
 * workspace collections -- avoids depending on error response fields the SDK doesn't
 * surface.
 */
export function findCollidingCloudWorkspace(input: {
  cloudWorkspaces: readonly CloudWorkspaceSummary[];
  gitOwner: string;
  gitRepoName: string;
  branch: string;
}): CloudWorkspaceSummary | null {
  const branch = input.branch.trim();
  return input.cloudWorkspaces.find((workspace) =>
    workspace.repo.owner === input.gitOwner
    && workspace.repo.name === input.gitRepoName
    && workspace.repo.branch.trim() === branch
  ) ?? null;
}

export function buildLocalToCloudMoveStartRequest(input: {
  repoConfigId: string;
  branch: string;
  baseCommitSha: string;
  desktopInstallId: string;
  anyharnessWorkspaceId: string;
  idempotencyKey: string;
}): StartWorkspaceMoveRequest {
  return {
    repoConfigId: input.repoConfigId,
    branch: input.branch,
    baseCommitSha: input.baseCommitSha,
    source: {
      kind: "local",
      desktopInstallId: input.desktopInstallId,
      anyharnessWorkspaceId: input.anyharnessWorkspaceId,
    },
    destination: { kind: "cloud" },
    idempotencyKey: input.idempotencyKey,
  };
}
