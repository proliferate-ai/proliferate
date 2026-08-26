import { describe, expect, it } from "vitest";
import { cloudBillingKey } from "#product/hooks/access/cloud/query-keys";

describe("cloud query keys", () => {
  it("scopes billing keys by personal and organization owners", () => {
    expect(cloudBillingKey()).toEqual(["cloud", "billing", "personal", null]);
    expect(cloudBillingKey({
      ownerScope: "organization",
      organizationId: "org-1",
    })).toEqual(["cloud", "billing", "organization", "org-1"]);
  });
});
