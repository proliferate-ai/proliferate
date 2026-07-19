import { describe, expect, it } from "vitest";
import {
  isWorkspaceSetupSessionId,
  resolveWorkspaceSetupSessionId,
} from "#product/lib/domain/workspaces/selection/setup-session";
import {
  resolveWorkspaceSessionRecoverySendBlockedReason,
} from "#product/lib/domain/workspaces/selection/session-recovery";

describe("workspace setup-session identity", () => {
  it("is deterministic, workspace-scoped, and uses the non-durable client-session namespace", () => {
    const first = resolveWorkspaceSetupSessionId("workspace/one");

    expect(first).toBe("client-session:workspace-setup:workspace%2Fone");
    expect(resolveWorkspaceSetupSessionId("workspace/one")).toBe(first);
    expect(resolveWorkspaceSetupSessionId("workspace-two")).not.toBe(first);
    expect(isWorkspaceSetupSessionId(first)).toBe(true);
    expect(isWorkspaceSetupSessionId("session-runtime-1")).toBe(false);
  });

  it("uses a truthful configuration-specific send blocker", () => {
    expect(resolveWorkspaceSessionRecoverySendBlockedReason(
      "launch-configuration-unavailable",
    )).toBe("Configure an agent before sending.");
    expect(resolveWorkspaceSessionRecoverySendBlockedReason(
      "session-create-failed",
    )).toBe("Retry this chat before sending.");
  });
});
