import { describe, expect, it } from "vitest";
import {
  buildLogicalWorkspaces,
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
});
