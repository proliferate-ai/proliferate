import { describe, expect, it } from "vitest";
import { shouldUseLocalRuntimeWorkspaceSessionsQuery } from "./workspace-session-query-target";

describe("workspace session query target", () => {
  it("uses the local runtime query for ordinary AnyHarness workspace ids", () => {
    expect(shouldUseLocalRuntimeWorkspaceSessionsQuery({
      workspaceId: "workspace-1",
      hotPaintPending: false,
    })).toBe(true);
  });

  it("does not let the local runtime query overwrite cloud workspace sessions", () => {
    expect(shouldUseLocalRuntimeWorkspaceSessionsQuery({
      workspaceId: "cloud:workspace-1",
      hotPaintPending: false,
    })).toBe(false);
  });

  it("does not let the local runtime query overwrite direct target workspace sessions", () => {
    expect(shouldUseLocalRuntimeWorkspaceSessionsQuery({
      workspaceId: "target:target-1:workspace-1",
      hotPaintPending: false,
    })).toBe(false);
  });

  it("waits while hot paint is pending", () => {
    expect(shouldUseLocalRuntimeWorkspaceSessionsQuery({
      workspaceId: "workspace-1",
      hotPaintPending: true,
    })).toBe(false);
  });
});
