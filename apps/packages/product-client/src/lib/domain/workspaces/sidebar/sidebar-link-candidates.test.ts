import { describe, expect, it } from "vitest";
import type { LogicalWorkspace } from "#product/lib/domain/workspaces/cloud/logical-workspace-model";
import { collectCloudWorkspaceLinkCandidates } from "#product/lib/domain/workspaces/sidebar/sidebar-workspace-items";

function slot(overrides: Partial<LogicalWorkspace>): LogicalWorkspace {
  return {
    id: "slot",
    repoKey: "repo",
    sourceRoot: "/repo",
    repoRoot: null,
    provider: "github",
    owner: "acme",
    repoName: "rocket",
    branchKey: "feat/CaseSensitive",
    displayName: "Rocket",
    localWorkspace: null,
    cloudWorkspace: null,
    mobilityWorkspace: null,
    preferredMaterializationId: null,
    effectiveOwner: "local",
    lifecycle: "local_active",
    updatedAt: "2026-07-16T00:00:00Z",
    ...overrides,
  } as LogicalWorkspace;
}

describe("collectCloudWorkspaceLinkCandidates", () => {
  it("finds an unlinked local slot beside a production-shaped managed Cloud row", () => {
    const cloud = slot({
      id: "cloud-slot",
      effectiveOwner: "cloud",
      lifecycle: "cloud_active",
      cloudWorkspace: {
        id: "cloud-1",
        materializations: [{ targetKind: "managed_cloud", id: "managed-1" }],
      } as never,
    });
    const local = slot({ id: "local-slot", localWorkspace: { id: "local-1" } as never });

    expect(collectCloudWorkspaceLinkCandidates([cloud, local], "install-1"))
      .toEqual(new Set(["cloud-1"]));
  });

  it("does not case-fold branches or offer linking when this install already has a row", () => {
    const local = slot({
      id: "local-slot",
      branchKey: "feat/casesensitive",
      localWorkspace: { id: "local-1" } as never,
    });
    const cloud = slot({
      id: "cloud-slot",
      cloudWorkspace: {
        id: "cloud-1",
        materializations: [{
          targetKind: "local_desktop",
          desktopInstallId: "install-1",
        }],
      } as never,
    });

    expect(collectCloudWorkspaceLinkCandidates([cloud, local], "install-1")).toEqual(new Set());
  });
});
