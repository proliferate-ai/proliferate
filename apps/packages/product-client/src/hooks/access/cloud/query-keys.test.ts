import { describe, expect, it } from "vitest";
import {
  cloudBillingKey,
  cloudWorkspaceConnectionKey,
  isCloudWorkspaceConnectionQueryKey,
} from "#product/hooks/access/cloud/query-keys";

describe("cloud query keys", () => {
  it("scopes billing keys by personal and organization owners", () => {
    expect(cloudBillingKey()).toEqual(["cloud", "billing", "personal", null]);
    expect(cloudBillingKey({
      ownerScope: "organization",
      organizationId: "org-1",
    })).toEqual(["cloud", "billing", "organization", "org-1"]);
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
});
