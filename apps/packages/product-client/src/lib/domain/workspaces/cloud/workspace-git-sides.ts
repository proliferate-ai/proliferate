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

/** A local side marked absent/missing/unreachable when no live status applies.
 * `absent` = no copy exists yet (Add/Open the copy); `missing` = a materialized
 * checkout is gone; `unreachable` = the runtime couldn't be queried this pass. */
export function localGitSideAbsent(
  presence: "absent" | "missing" | "unreachable",
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
 * The Cloud side from a LIVE `GitStatusSnapshot` read against the Cloud
 * workspace's own AnyHarness runtime (client-reachable via the resolved cloud
 * connection). This is the truthful path (PR6-CLOUD-TRUTH-01): clean/conflicted/
 * operation/ahead/behind come from the live read, never fabricated.
 */
export function cloudGitSideFromStatus(
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

/**
 * The Cloud side when NO live status could be read — the runtime was not
 * reachable this pass. The head/branch reflect the LAST-REPORTED materialization
 * row (a legitimate exact ref), but every cleanliness/sync field is UNKNOWN
 * (null): the relation resolver must NOT claim same_head or "safe" from this
 * (PR6-CLOUD-TRUTH-01) — it emits `cloud_state_unverified` → manual guidance.
 *
 * `missing` (the managed row itself reports missing/failed, or is absent) still
 * surfaces as a missing/absent presence so recovery/Add flows apply.
 */
export function cloudGitSideLastReported(
  managed: CloudWorkspaceMaterializationSummary | null,
  repo: CloudWorkspaceRepoRef | null,
): WorkspaceGitSide {
  if (!managed) {
    // No managed Cloud copy exists yet — this is Add-Cloud-copy territory.
    return {
      presence: "absent",
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
  if (managed.state === "missing" || managed.state === "failed") {
    return {
      presence: "missing",
      provider: repo?.provider ?? null,
      owner: repo?.owner ?? null,
      repoName: repo?.name ?? null,
      branch: managed.observedBranch ?? repo?.branch ?? null,
      headSha: managed.observedHeadSha ?? managed.expectedHeadSha ?? null,
      clean: null,
      conflicted: null,
      detached: null,
      operationInProgress: null,
      ahead: null,
      behind: null,
      hasUpstream: null,
    };
  }
  // We have a last-REPORTED record of the Cloud copy (presence "present") but did
  // NOT read its live state, so every cleanliness/sync field is UNKNOWN (null).
  // classifyWorkspaceGitSide → "unknown" → deriveWorkspaceGitRelation emits
  // `cloud_state_unverified`, which blocks any same_head/safe claim while still
  // showing the last-reported head. Never a fabricated-clean side.
  return {
    presence: "present",
    provider: repo?.provider ?? null,
    owner: repo?.owner ?? null,
    repoName: repo?.name ?? null,
    branch: managed.observedBranch ?? repo?.branch ?? null,
    headSha: managed.observedHeadSha ?? managed.expectedHeadSha ?? null,
    clean: null,
    conflicted: null,
    detached: null,
    operationInProgress: null,
    ahead: null,
    behind: null,
    hasUpstream: null,
  };
}
