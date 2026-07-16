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

  it("maps link-copies to a distinct association-only link_copies intent (not relink)", () => {
    // Flow 4 is association-only and must NOT map to relink/recreate (which
    // materialize). See PR5-LINK-01.
    expect(workspaceAvailabilityIntentForCommand("link-copies", FULL)).toEqual({
      kind: "link_copies",
      cloudWorkspaceId: "cloud-1",
    });
  });

  it("maps relink to relink mode and recreate to recreate mode", () => {
    expect(workspaceAvailabilityIntentForCommand("relink-existing", FULL)).toEqual({
      kind: "relink",
      cloudWorkspaceId: "cloud-1",
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
    expect(
      workspaceAvailabilityIntentForCommand("link-copies", { ...FULL, cloudWorkspaceId: null }),
    ).toBeNull();
  });

  it("maps reconcile-git-state to a reconcile intent carrying both ids", () => {
    expect(workspaceAvailabilityIntentForCommand("reconcile-git-state", FULL)).toEqual({
      kind: "reconcile",
      localWorkspaceId: "ws-1",
      cloudWorkspaceId: "cloud-1",
      materializationId: "mat-1",
    });
  });

  it("returns null for reconcile-git-state when neither side is present", () => {
    expect(
      workspaceAvailabilityIntentForCommand("reconcile-git-state", {
        ...FULL,
        localWorkspaceId: null,
        cloudWorkspaceId: null,
      }),
    ).toBeNull();
  });
});
