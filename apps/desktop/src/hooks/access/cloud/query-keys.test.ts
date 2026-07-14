import { describe, expect, it } from "vitest";
import {
  cloudBillingKey,
  cloudWorktreeRetentionPolicyKey,
  cloudWorkspaceConnectionAuthorityKey,
  cloudWorkspaceConnectionKey,
  isCloudWorkspaceConnectionQueryKey,
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

  it("scopes workspace connection keys by owner", () => {
    const owner = { ownerScope: "organization" as const, organizationId: "org-1" };

    expect(cloudWorkspaceConnectionKey("workspace-1", owner)).toEqual([
      "cloud",
      "workspaces",
      "workspace-1",
      "connection",
      "organization",
      "org-1",
    ]);
  });

  it("recognizes scoped invalidation predicates", () => {
    expect(isCloudWorkspaceConnectionQueryKey(
      cloudWorkspaceConnectionKey("workspace-1"),
    )).toBe(true);
  });

  it("adds a credential-free authority scope to connection keys", () => {
    expect(cloudWorkspaceConnectionAuthorityKey(
      "workspace-1",
      "https://api.example.test::user:user-1::cloud-client:7",
    )).toEqual([
      "cloud",
      "workspaces",
      "workspace-1",
      "connection",
      "personal",
      null,
      "authority",
      "https://api.example.test::user:user-1::cloud-client:7",
    ]);
  });
});
