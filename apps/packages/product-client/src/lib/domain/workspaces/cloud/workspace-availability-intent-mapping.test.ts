import { describe, expect, it } from "vitest";
import { workspaceAvailabilityIntentForCommand } from "#product/lib/domain/workspaces/cloud/workspace-availability-intent-mapping";

const FULL = {
  localWorkspaceId: "ws-1",
  cloudWorkspaceId: "cloud-1",
  linkedMaterializationId: "mat-1",
  repoOwner: "acme",
  repoName: "rocket",
};

describe("workspaceAvailabilityIntentForCommand", () => {
  it("maps add-cloud-copy to an add_cloud_copy intent", () => {
    expect(workspaceAvailabilityIntentForCommand("add-cloud-copy", FULL)).toEqual({
      kind: "add_cloud_copy",
      localWorkspaceId: "ws-1",
      gitOwner: "acme",
      gitRepoName: "rocket",
    });
  });

  it("maps open-on-this-mac to an open_on_mac intent", () => {
    expect(workspaceAvailabilityIntentForCommand("open-on-this-mac", FULL)).toEqual({
      kind: "open_on_mac",
      cloudWorkspaceId: "cloud-1",
    });
  });

  it("maps link/relink to relink and recreate to recreate", () => {
    expect(workspaceAvailabilityIntentForCommand("link-copies", FULL)).toEqual({
      kind: "relink",
      cloudWorkspaceId: "cloud-1",
      mode: "relink",
    });
    expect(workspaceAvailabilityIntentForCommand("relink-existing", FULL)).toMatchObject({
      mode: "relink",
    });
    expect(workspaceAvailabilityIntentForCommand("recreate-on-this-mac", FULL)).toEqual({
      kind: "relink",
      cloudWorkspaceId: "cloud-1",
      mode: "recreate",
    });
  });

  it("maps unlink-this-mac to an unlink intent with the materialization id", () => {
    expect(workspaceAvailabilityIntentForCommand("unlink-this-mac", FULL)).toEqual({
      kind: "unlink",
      cloudWorkspaceId: "cloud-1",
      materializationId: "mat-1",
    });
  });

  it("returns null when required identifiers are missing", () => {
    expect(
      workspaceAvailabilityIntentForCommand("add-cloud-copy", { ...FULL, localWorkspaceId: null }),
    ).toBeNull();
    expect(
      workspaceAvailabilityIntentForCommand("open-on-this-mac", { ...FULL, cloudWorkspaceId: null }),
    ).toBeNull();
    expect(
      workspaceAvailabilityIntentForCommand("unlink-this-mac", { ...FULL, linkedMaterializationId: null }),
    ).toBeNull();
  });

  it("returns null for the non-actionable blocker", () => {
    expect(workspaceAvailabilityIntentForCommand("unsupported-git-state", FULL)).toBeNull();
  });
});
