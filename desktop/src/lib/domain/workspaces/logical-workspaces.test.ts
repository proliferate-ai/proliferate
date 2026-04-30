import { describe, expect, it } from "vitest";
import type { CloudMobilityWorkspaceSummary } from "@/lib/integrations/cloud/client";
import { cloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud-ids";
import {
  buildLogicalWorkspaces,
  replaceLogicalWorkspaceBranch,
  resolveLogicalWorkspaceMaterializationId,
} from "@/lib/domain/workspaces/logical-workspaces";
import { makeCloudWorkspace, makeWorkspace } from "@/lib/domain/workspaces/sidebar-test-fixtures";

function makeMobilityWorkspace(args: {
  owner: "local" | "cloud";
  branch?: string;
  cloudWorkspaceId?: string | null;
}): CloudMobilityWorkspaceSummary {
  const {
    owner,
    branch = "main",
    cloudWorkspaceId = "cloud-1",
  } = args;

  return {
    id: "mobility-1",
    displayName: branch,
    repo: {
      provider: "github",
      owner: "proliferate-ai",
      name: "proliferate",
      branch,
    },
    owner,
    lifecycleState: owner === "cloud" ? "cloud_active" : "local_active",
    statusDetail: null,
    lastError: null,
    cloudWorkspaceId,
    cloudLostAt: null,
    cloudLostReason: null,
    activeHandoff: null,
    updatedAt: "2026-04-13T00:00:00Z",
    createdAt: "2026-04-13T00:00:00Z",
  };
}

describe("logical workspaces", () => {
  it("keeps mobility-only placeholders without throwing", () => {
    const logicalWorkspaces = buildLogicalWorkspaces({
      localWorkspaces: [],
      repoRoots: [],
      cloudWorkspaces: [],
      cloudMobilityWorkspaces: [
        {
          id: "mobility-1",
          displayName: "seal",
          repo: {
            provider: "github",
            owner: "proliferate-ai",
            name: "landing",
            branch: "seal",
          },
          owner: "local",
          lifecycleState: "moving_to_cloud",
          statusDetail: "Preparing cloud workspace",
          lastError: null,
          cloudWorkspaceId: null,
          cloudLostAt: null,
          cloudLostReason: null,
          activeHandoff: null,
          updatedAt: "2026-04-13T00:00:00Z",
          createdAt: "2026-04-13T00:00:00Z",
        },
      ],
      currentSelectionId: null,
    });

    expect(logicalWorkspaces).toHaveLength(1);
    expect(logicalWorkspaces[0]?.preferredMaterializationId).toBeNull();
    expect(resolveLogicalWorkspaceMaterializationId(logicalWorkspaces[0]!)).toBeNull();
  });

  it("honors a local mobility owner over a stale selected cloud materialization", () => {
    const localWorkspace = makeWorkspace({
      id: "local-1",
      branch: "gannet",
    });
    const cloudWorkspace = makeCloudWorkspace({
      id: "cloud-1",
      branch: "gannet",
    });
    const staleCloudSelectionId = cloudWorkspaceSyntheticId(cloudWorkspace.id);

    const logicalWorkspaces = buildLogicalWorkspaces({
      localWorkspaces: [localWorkspace],
      repoRoots: [],
      cloudWorkspaces: [cloudWorkspace],
      cloudMobilityWorkspaces: [
        makeMobilityWorkspace({
          owner: "local",
          branch: "gannet",
          cloudWorkspaceId: cloudWorkspace.id,
        }),
      ],
      currentSelectionId: staleCloudSelectionId,
    });

    expect(logicalWorkspaces).toHaveLength(1);
    expect(logicalWorkspaces[0]?.preferredMaterializationId).toBe(localWorkspace.id);
    expect(logicalWorkspaces[0]?.effectiveOwner).toBe("local");
    expect(resolveLogicalWorkspaceMaterializationId(
      logicalWorkspaces[0]!,
      staleCloudSelectionId,
    )).toBe(localWorkspace.id);
  });

  it("honors a cloud mobility owner over a stale selected local materialization", () => {
    const localWorkspace = makeWorkspace({
      id: "local-1",
      branch: "gannet",
    });
    const cloudWorkspace = makeCloudWorkspace({
      id: "cloud-1",
      branch: "gannet",
    });
    const cloudSelectionId = cloudWorkspaceSyntheticId(cloudWorkspace.id);

    const logicalWorkspaces = buildLogicalWorkspaces({
      localWorkspaces: [localWorkspace],
      repoRoots: [],
      cloudWorkspaces: [cloudWorkspace],
      cloudMobilityWorkspaces: [
        makeMobilityWorkspace({
          owner: "cloud",
          branch: "gannet",
          cloudWorkspaceId: cloudWorkspace.id,
        }),
      ],
      currentSelectionId: localWorkspace.id,
    });

    expect(logicalWorkspaces).toHaveLength(1);
    expect(logicalWorkspaces[0]?.preferredMaterializationId).toBe(cloudSelectionId);
    expect(logicalWorkspaces[0]?.effectiveOwner).toBe("cloud");
    expect(resolveLogicalWorkspaceMaterializationId(
      logicalWorkspaces[0]!,
      localWorkspace.id,
    )).toBe(cloudSelectionId);
  });

  it("replaces the branch segment while preserving logical workspace identity", () => {
    expect(
      replaceLogicalWorkspaceBranch(
        "remote:github:proliferate-ai:proliferate:parrot",
        "feature/hi",
      ),
    ).toBe("remote:github:proliferate-ai:proliferate:feature%2Fhi");

    expect(
      replaceLogicalWorkspaceBranch(
        "repo-root:repo-root-1:parrot",
        "hi",
      ),
    ).toBe("repo-root:repo-root-1:hi");

    expect(
      replaceLogicalWorkspaceBranch(
        "path:%2FUsers%2Fpablo%2Fproliferate:parrot",
        "hi",
      ),
    ).toBe("path:%2FUsers%2Fpablo%2Fproliferate:hi");
  });
});
