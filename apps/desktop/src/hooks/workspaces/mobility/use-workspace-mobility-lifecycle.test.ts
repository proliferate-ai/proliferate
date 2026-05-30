import { describe, expect, it } from "vitest";
import type { CloudWorkspaceDetail } from "@/lib/access/cloud/client";
import { describeDestinationWorkspaceHandoffFailure } from "./use-workspace-mobility-lifecycle";

function workspace(
  overrides: Partial<CloudWorkspaceDetail>,
): CloudWorkspaceDetail {
  return {
    id: "workspace-1",
    displayName: "Workspace",
    repo: {
      provider: "github",
      owner: "owner",
      name: "repo",
      branch: "branch",
      baseBranch: "main",
    },
    status: "pending",
    workspaceStatus: "pending",
    statusDetail: null,
    lastError: null,
    visibility: "private",
    createdAt: "2026-05-30T00:00:00.000Z",
    updatedAt: "2026-05-30T00:00:00.000Z",
    archivedAt: null,
    readyAt: null,
    ...overrides,
  } as CloudWorkspaceDetail;
}

describe("describeDestinationWorkspaceHandoffFailure", () => {
  it("tolerates a temporarily missing destination while provisioning starts", () => {
    expect(describeDestinationWorkspaceHandoffFailure(null, {
      elapsedMs: 5_000,
    })).toBeNull();
  });

  it("reports a missing destination after the readiness grace window", () => {
    expect(describeDestinationWorkspaceHandoffFailure(null, {
      elapsedMs: 120_000,
    })).toBe("Cloud workspace not found.");
  });

  it("keeps waiting for pending destination workspaces", () => {
    expect(describeDestinationWorkspaceHandoffFailure(workspace({
      status: "materializing",
      workspaceStatus: "materializing",
    }), {
      elapsedMs: 20_000,
    })).toBeNull();
  });

  it("reports terminal destination failures immediately", () => {
    expect(describeDestinationWorkspaceHandoffFailure(workspace({
      status: "error",
      workspaceStatus: "error",
      lastError: "Provisioning failed",
    }), {
      elapsedMs: 1_000,
    })).toBe("Provisioning failed");
  });
});
