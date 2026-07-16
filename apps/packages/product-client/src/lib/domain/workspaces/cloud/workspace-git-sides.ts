import type { GitStatusSnapshot } from "@anyharness/sdk";
import type {
  CloudWorkspaceMaterializationSummary,
  CloudWorkspaceRepoRef,
} from "#product/lib/domain/workspaces/cloud/cloud-workspace-model";
import type { WorkspaceGitSide } from "#product/lib/domain/workspaces/cloud/workspace-git-relation";

/**
 * PR 6 — pure adapters that build a `WorkspaceGitSide` for the relation resolver
 * from the structured inputs the runtime and control plane actually expose. Kept
 * pure so the exact field mapping (§B-7: `dirty = !clean`, `detached`,
 * `operation !== "none"`, `ahead>0`, `behind>0`, `hasUpstream`) is testable.
 */

/** The local side from a fresh AnyHarness `GitStatusSnapshot`. */
export function localGitSideFromStatus(
  status: GitStatusSnapshot,
  repo: Pick<CloudWorkspaceRepoRef, "provider" | "owner" | "name"> | null,
): WorkspaceGitSide {
  return {
    presence: "present",
    provider: repo?.provider ?? null,
    owner: repo?.owner ?? null,
    repoName: repo?.name ?? null,
    branch: status.currentBranch ?? null,
    headSha: status.headOid,
    clean: status.clean,
    conflicted: status.conflicted,
    detached: status.detached,
    operationInProgress: status.operation !== "none",
    ahead: status.ahead,
    behind: status.behind,
    hasUpstream: Boolean(status.upstreamBranch?.trim()),
  };
}

/** A local side marked missing/unreachable when no live status is available. */
export function localGitSideAbsent(
  presence: "missing" | "unreachable",
  repo: Pick<CloudWorkspaceRepoRef, "provider" | "owner" | "name"> | null,
  branch: string | null,
): WorkspaceGitSide {
  return {
    presence,
    provider: repo?.provider ?? null,
    owner: repo?.owner ?? null,
    repoName: repo?.name ?? null,
    branch,
    headSha: null,
    clean: null,
    conflicted: null,
    detached: null,
    operationInProgress: null,
    ahead: null,
    behind: null,
    hasUpstream: null,
  };
}

/**
 * The Cloud side from the managed_cloud materialization row. There is NO live
 * Cloud runtime status to query here, so this reflects the LAST-KNOWN observed
 * HEAD/branch (a clean, published normal branch by construction of the managed
 * materialization). ahead/behind are unknown (0) — the relation resolver treats
 * equal heads as same_head and any head difference as diverged, never guessing.
 */
export function cloudGitSideFromMaterialization(
  managed: CloudWorkspaceMaterializationSummary | null,
  repo: CloudWorkspaceRepoRef | null,
): WorkspaceGitSide {
  if (!managed) {
    return {
      presence: "missing",
      provider: repo?.provider ?? null,
      owner: repo?.owner ?? null,
      repoName: repo?.name ?? null,
      branch: repo?.branch ?? null,
      headSha: null,
      clean: null,
      conflicted: null,
      detached: null,
      operationInProgress: null,
      ahead: null,
      behind: null,
      hasUpstream: null,
    };
  }
  const presence = managed.state === "missing" || managed.state === "failed"
    ? "missing"
    : "present";
  return {
    presence,
    provider: repo?.provider ?? null,
    owner: repo?.owner ?? null,
    repoName: repo?.name ?? null,
    branch: managed.observedBranch ?? repo?.branch ?? null,
    headSha: managed.observedHeadSha ?? managed.expectedHeadSha ?? null,
    clean: presence === "present" ? true : null,
    conflicted: presence === "present" ? false : null,
    detached: presence === "present" ? false : null,
    operationInProgress: presence === "present" ? false : null,
    ahead: presence === "present" ? 0 : null,
    behind: presence === "present" ? 0 : null,
    hasUpstream: presence === "present" ? true : null,
  };
}
