import { describe, expect, it } from "vitest";
import type { CloudMobilityWorkspaceSummary } from "@/lib/integrations/cloud/client";
import { cloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud-ids";
import {
  buildLogicalWorkspaces,
  latestLogicalWorkspaceTimestamp,
  logicalWorkspaceRelatedIds,
  replaceLogicalWorkspaceBranch,
  resolveLogicalWorkspaceMaterializationId,
} from "@/lib/domain/workspaces/logical-workspaces";
import {
  buildGroups,
  makeCloudWorkspace,
  makeRepoRoot,
  makeWorkspace,
} from "@/lib/domain/workspaces/sidebar-test-fixtures";

function makeMobilityWorkspace(args: {
  id?: string;
  owner: "local" | "cloud";
  branch?: string;
  cloudWorkspaceId?: string | null;
}): CloudMobilityWorkspaceSummary {
  const {
    id = "mobility-1",
    owner,
    branch = "main",
    cloudWorkspaceId = "cloud-1",
  } = args;

  return {
    id,
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

  it("groups mobility-only placeholders by repository identity instead of branch identity", () => {
    const logicalWorkspaces = buildLogicalWorkspaces({
      localWorkspaces: [],
      repoRoots: [],
      cloudWorkspaces: [],
      cloudMobilityWorkspaces: [
        makeMobilityWorkspace({
          id: "mobility-1",
          owner: "cloud",
          branch: "twilight",
          cloudWorkspaceId: "cloud-1",
        }),
        makeMobilityWorkspace({
          id: "mobility-2",
          owner: "cloud",
          branch: "ember",
          cloudWorkspaceId: "cloud-2",
        }),
      ],
      currentSelectionId: null,
    });

    expect(logicalWorkspaces).toHaveLength(2);
    expect(logicalWorkspaces.map((workspace) => workspace.repoKey)).toEqual([
      "github:proliferate-ai:proliferate",
      "github:proliferate-ai:proliferate",
    ]);
    expect(logicalWorkspaces.map((workspace) => workspace.repoName)).toEqual([
      "proliferate",
      "proliferate",
    ]);
    expect(logicalWorkspaces.map((workspace) => workspace.branchKey).sort()).toEqual([
      "ember",
      "twilight",
    ]);
  });

  it("merges a matching local repo root with mobility-only placeholders in one sidebar group", () => {
    const logicalWorkspaces = buildLogicalWorkspaces({
      localWorkspaces: [],
      repoRoots: [makeRepoRoot({ sourceRoot: "/tmp/proliferate" })],
      cloudWorkspaces: [],
      cloudMobilityWorkspaces: [
        makeMobilityWorkspace({
          id: "mobility-1",
          owner: "cloud",
          branch: "twilight",
          cloudWorkspaceId: "cloud-1",
        }),
        makeMobilityWorkspace({
          id: "mobility-2",
          owner: "cloud",
          branch: "ember",
          cloudWorkspaceId: "cloud-2",
        }),
      ],
      currentSelectionId: null,
    });

    const groups = buildGroups({
      repoRoots: [makeRepoRoot({ sourceRoot: "/tmp/proliferate" })],
      logicalWorkspaces,
    });

    expect(groups).toHaveLength(1);
    expect(groups[0]?.sourceRoot).toBe("/tmp/proliferate");
    expect(groups[0]?.name).toBe("proliferate");
    expect(groups[0]?.items.map((item) => item.id)).toHaveLength(2);
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

  it("groups logical, local, and cloud materialization ids for attention timestamps", () => {
    const localWorkspace = makeWorkspace({
      id: "local-1",
      branch: "gannet",
    });
    const cloudWorkspace = makeCloudWorkspace({
      id: "cloud-1",
      branch: "gannet",
    });
    const logicalWorkspace = buildLogicalWorkspaces({
      localWorkspaces: [localWorkspace],
      repoRoots: [],
      cloudWorkspaces: [cloudWorkspace],
      currentSelectionId: localWorkspace.id,
    })[0]!;

    expect(logicalWorkspaceRelatedIds(logicalWorkspace)).toEqual([
      "remote:github:proliferate-ai:proliferate:gannet",
      "local-1",
      "cloud:cloud-1",
    ]);
    expect(latestLogicalWorkspaceTimestamp({
      "remote:github:proliferate-ai:proliferate:gannet": "2026-04-13T10:00:00.000Z",
      "cloud:cloud-1": "2026-04-13T10:05:00.000Z",
      "local-1": "2026-04-13T10:10:00.000Z",
    }, logicalWorkspace)).toBe("2026-04-13T10:10:00.000Z");
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
