import { describe, expect, it } from "vitest";
import {
  resolveWorkspaceShellStateKey,
  resolveWorkspaceUiKey,
} from "./workspace-ui-key";

describe("workspace ui keys", () => {
  it("uses the logical workspace key for selected shell state", () => {
    expect(resolveWorkspaceShellStateKey({
      workspaceId: "materialized-workspace",
      selectedWorkspaceId: "materialized-workspace",
      selectedLogicalWorkspaceId: "logical-workspace",
    })).toBe("logical-workspace");
  });

  it("uses an explicit shell workspace key before selected identity", () => {
    expect(resolveWorkspaceShellStateKey({
      workspaceId: "materialized-workspace",
      shellWorkspaceId: "explicit-shell",
      selectedWorkspaceId: "materialized-workspace",
      selectedLogicalWorkspaceId: "logical-workspace",
    })).toBe("explicit-shell");
  });

  it("falls back to materialized workspace ids for unselected shell writes", () => {
    expect(resolveWorkspaceShellStateKey({
      workspaceId: "other-workspace",
      selectedWorkspaceId: "materialized-workspace",
      selectedLogicalWorkspaceId: "logical-workspace",
    })).toBe("other-workspace");
  });

  it("resolves the workspace ui key from logical identity first", () => {
    expect(resolveWorkspaceUiKey("logical-workspace", "materialized-workspace"))
      .toBe("logical-workspace");
  });
});
