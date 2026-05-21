import { describe, expect, it } from "vitest";
import { groupComputeTargetsByOwnerScope } from "@/lib/domain/compute/target-presentation";
import type { ComputeTargetSummary } from "@/lib/domain/compute/target-types";

function target(
  id: string,
  ownerScope: ComputeTargetSummary["ownerScope"],
): ComputeTargetSummary {
  return {
    id,
    displayName: id,
    kind: "managed_cloud",
    status: "online",
    ownerScope,
    organizationId: ownerScope === "organization" ? "org_1" : null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("groupComputeTargetsByOwnerScope", () => {
  it("keeps personal and organization compute targets in separate stable groups", () => {
    const groups = groupComputeTargetsByOwnerScope([
      target("personal-1", "personal"),
      target("org-1", "organization"),
      target("personal-2", "personal"),
    ]);

    expect(groups.map((group) => group.id)).toEqual(["personal", "organization"]);
    expect(groups[0]?.targets.map((item) => item.id)).toEqual(["personal-1", "personal-2"]);
    expect(groups[1]?.targets.map((item) => item.id)).toEqual(["org-1"]);
  });
});
