import { describe, expect, it } from "vitest";
import type { CloudWorkspaceDetail } from "@/lib/access/cloud/client";
import { describeCloudWorkspaceNotReadyFailure } from "./use-cloud-workspace-readiness-waiter";

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

describe("describeCloudWorkspaceNotReadyFailure", () => {
  it("keeps polling pending workspaces", () => {
    expect(describeCloudWorkspaceNotReadyFailure(workspace({
      status: "materializing",
      workspaceStatus: "materializing",
    }))).toBeNull();
  });

  it("uses the cloud failure detail for errored workspaces", () => {
    expect(describeCloudWorkspaceNotReadyFailure(workspace({
      status: "error",
      workspaceStatus: "error",
      lastError: "Managed cloud worker enrollment requires CLOUD_WORKER_BASE_URL.",
      statusDetail: "Provisioning failed",
    }))).toBe("Managed cloud worker enrollment requires CLOUD_WORKER_BASE_URL.");
  });

  it("fails immediately for terminal non-ready statuses", () => {
    expect(describeCloudWorkspaceNotReadyFailure(workspace({
      status: "archived",
      workspaceStatus: "archived",
      statusDetail: "Workspace archived",
    }))).toBe("Workspace archived");
  });
});
