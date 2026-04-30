import { describe, expect, it } from "vitest";
import {
  buildLogicalWorkspaces,
  replaceLogicalWorkspaceBranch,
  resolveLogicalWorkspaceMaterializationId,
} from "@/lib/domain/workspaces/logical-workspaces";

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
