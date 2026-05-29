import { describe, expect, it } from "vitest";
import {
  parseTargetWorkspaceSyntheticId,
  targetWorkspaceSyntheticId,
} from "./target-workspace-id";

describe("target workspace synthetic ids", () => {
  it("round trips a target workspace id", () => {
    const id = targetWorkspaceSyntheticId("target-1", "workspace-1");

    expect(parseTargetWorkspaceSyntheticId(id)).toEqual({
      targetId: "target-1",
      anyharnessWorkspaceId: "workspace-1",
    });
  });

  it("rejects non-target workspace ids", () => {
    expect(parseTargetWorkspaceSyntheticId("workspace-1")).toBeNull();
    expect(parseTargetWorkspaceSyntheticId("cloud:workspace-1")).toBeNull();
    expect(parseTargetWorkspaceSyntheticId("target:target-1")).toBeNull();
  });
});
