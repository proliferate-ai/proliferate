import { describe, expect, it } from "vitest";
import { AnyHarnessError } from "@anyharness/sdk";
import { isWorkspaceArchivedRefusal } from "#product/lib/domain/workspaces/archived/workspace-archived-refusal";

describe("isWorkspaceArchivedRefusal", () => {
  it("recognizes a typed WORKSPACE_ARCHIVED refusal", () => {
    const error = new AnyHarnessError({
      type: "about:blank",
      title: "Conflict",
      status: 409,
      code: "WORKSPACE_ARCHIVED",
    });
    expect(isWorkspaceArchivedRefusal(error)).toBe(true);
  });

  it("returns false for a different typed error code", () => {
    const error = new AnyHarnessError({
      type: "about:blank",
      title: "Conflict",
      status: 409,
      code: "WORKSPACE_OPERATION_IN_FLIGHT",
    });
    expect(isWorkspaceArchivedRefusal(error)).toBe(false);
  });

  it("returns false for a non-AnyHarnessError", () => {
    expect(isWorkspaceArchivedRefusal(new Error("boom"))).toBe(false);
    expect(isWorkspaceArchivedRefusal(undefined)).toBe(false);
  });
});
