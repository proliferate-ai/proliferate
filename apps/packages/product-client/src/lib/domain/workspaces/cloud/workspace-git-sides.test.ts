import { describe, expect, it } from "vitest";
import type { GitStatusSnapshot } from "@anyharness/sdk";
import {
  cloudGitSideFromStatus,
  cloudGitSideLastReported,
  localGitSideAbsent,
  localGitSideFromStatus,
} from "#product/lib/domain/workspaces/cloud/workspace-git-sides";
import type { CloudWorkspaceMaterializationSummary, CloudWorkspaceRepoRef } from "#product/lib/domain/workspaces/cloud/cloud-workspace-model";

const HEAD = "a".repeat(40);
const repo: CloudWorkspaceRepoRef = {
  provider: "github",
  owner: "acme",
  name: "rocket",
  branch: "feat/x",
  baseBranch: "main",
};

function status(overrides: Partial<GitStatusSnapshot> = {}): GitStatusSnapshot {
  return {
    actions: {
      canCommit: true,
      canCreateBranchWorkspace: true,
      canCreateDraftPullRequest: true,
      canCreatePullRequest: true,
      canPush: true,
      pushLabel: "Push",
    },
    ahead: 0,
    behind: 0,
    clean: true,
    conflicted: false,
    currentBranch: "feat/x",
    detached: false,
    files: [],
    headOid: HEAD,
    operation: "none",
    repoRootPath: "/repo",
    summary: { additions: 0, changedFiles: 0, conflictedFiles: 0, deletions: 0, includedFiles: 0 },
    upstreamBranch: "origin/feat/x",
    workspaceId: "ws-1",
    workspacePath: "/repo/ws-1",
    ...overrides,
  };
}

describe("localGitSideFromStatus — §B-7 field mapping", () => {
  it("maps dirty=!clean, operation, ahead/behind, hasUpstream", () => {
    const side = localGitSideFromStatus(
      status({ clean: false, operation: "rebase", ahead: 2, behind: 1, upstreamBranch: "origin/feat/x" }),
      repo,
    );
    expect(side).toMatchObject({
      presence: "present",
      branch: "feat/x",
      headSha: HEAD,
      clean: false,
      operationInProgress: true,
      ahead: 2,
      behind: 1,
      hasUpstream: true,
    });
  });

  it("treats a blank/absent upstream as not published", () => {
    expect(localGitSideFromStatus(status({ upstreamBranch: null }), repo).hasUpstream).toBe(false);
    expect(localGitSideFromStatus(status({ upstreamBranch: "  " }), repo).hasUpstream).toBe(false);
  });
});

describe("localGitSideAbsent", () => {
  it("marks presence and leaves facts unknown", () => {
    const side = localGitSideAbsent("missing", repo, "feat/x");
    expect(side.presence).toBe("missing");
    expect(side.clean).toBeNull();
    expect(side.headSha).toBeNull();
  });
});

describe("cloudGitSideFromStatus — live cloud read (§B-7)", () => {
  it("maps the LIVE cloud status truthfully (no fabricated clean)", () => {
    const side = cloudGitSideFromStatus(
      status({ clean: false, conflicted: true, ahead: 2, headOid: HEAD }),
      repo,
    );
    expect(side).toMatchObject({
      presence: "present",
      headSha: HEAD,
      clean: false,
      conflicted: true,
      ahead: 2,
    });
  });
});

describe("cloudGitSideLastReported — no live read (PR6-CLOUD-TRUTH-01)", () => {
  const managed: CloudWorkspaceMaterializationSummary = {
    id: "m",
    targetKind: "managed_cloud",
    desktopInstallId: null,
    anyharnessWorkspaceId: "cloud-ws",
    worktreePath: "/cloud",
    state: "hydrated",
    generation: 1,
    expectedHeadSha: HEAD,
    observedHeadSha: HEAD,
    observedBranch: "feat/x",
    failureCode: null,
    lastReportedAt: null,
  };

  it("keeps the last-reported head but marks cleanliness UNKNOWN (never fabricated clean)", () => {
    // presence "present" + null cleanliness → classifies as unknown →
    // cloud_state_unverified in the resolver (blocks any same_head/safe claim).
    const side = cloudGitSideLastReported(managed, repo);
    expect(side.presence).toBe("present");
    expect(side.headSha).toBe(HEAD);
    expect(side.clean).toBeNull();
    expect(side.conflicted).toBeNull();
    expect(side.ahead).toBeNull();
    expect(side.behind).toBeNull();
  });

  it("marks the cloud side missing when the managed row is missing/failed, absent when none", () => {
    expect(cloudGitSideLastReported({ ...managed, state: "missing" }, repo).presence).toBe("missing");
    expect(cloudGitSideLastReported(null, repo).presence).toBe("absent");
  });
});
