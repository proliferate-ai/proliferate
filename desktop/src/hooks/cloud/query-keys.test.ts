import { describe, expect, it } from "vitest";
import {
  cloudBillingKey,
  cloudWorktreeRetentionPolicyKey,
  cloudWorkspaceConnectionKey,
  cloudWorkspaceRepoConfigStatusKey,
  isCloudWorkspaceConnectionQueryKey,
  isCloudWorkspaceRepoConfigStatusQueryKey,
} from "./query-keys";

describe("cloud query keys", () => {
  it("scopes billing keys by personal and organization owners", () => {
    expect(cloudBillingKey()).toEqual(["cloud", "billing", "personal", null]);
    expect(cloudBillingKey({
      ownerScope: "organization",
      organizationId: "org-1",
    })).toEqual(["cloud", "billing", "organization", "org-1"]);
  });

  it("scopes account policy keys by user", () => {
    expect(cloudWorktreeRetentionPolicyKey("user-1")).toEqual([
      "cloud",
      "worktree-retention-policy",
      "user-1",
    ]);
    expect(cloudWorktreeRetentionPolicyKey("user-2")).toEqual([
      "cloud",
      "worktree-retention-policy",
      "user-2",
    ]);
  });

  it("scopes workspace connection and repo config keys by owner", () => {
    const owner = { ownerScope: "organization" as const, organizationId: "org-1" };

    expect(cloudWorkspaceConnectionKey("workspace-1", owner)).toEqual([
      "cloud",
      "workspaces",
      "workspace-1",
      "connection",
      "organization",
      "org-1",
    ]);
    expect(cloudWorkspaceRepoConfigStatusKey("workspace-1", owner)).toEqual([
      "cloud",
      "workspaces",
      "workspace-1",
      "repo-config-status",
      "organization",
      "org-1",
    ]);
  });

  it("recognizes scoped invalidation predicates", () => {
    expect(isCloudWorkspaceConnectionQueryKey(
      cloudWorkspaceConnectionKey("workspace-1"),
    )).toBe(true);
    expect(isCloudWorkspaceRepoConfigStatusQueryKey(
      cloudWorkspaceRepoConfigStatusKey("workspace-1"),
    )).toBe(true);
  });
});
