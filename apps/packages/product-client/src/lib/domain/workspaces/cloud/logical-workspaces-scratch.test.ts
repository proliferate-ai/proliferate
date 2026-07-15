import { describe, expect, it } from "vitest";
import type { CloudWorkspaceSummary } from "#product/lib/domain/workspaces/cloud/cloud-workspace-model";
import { cloudWorkspaceSyntheticId } from "#product/lib/domain/workspaces/cloud/cloud-ids";
import { buildLogicalWorkspaces } from "#product/lib/domain/workspaces/cloud/logical-workspaces";
import { buildLogicalWorkspaceIdForCloudWorkspace } from "#product/lib/domain/workspaces/cloud/logical-workspace-source";
import {
  buildCloudWorkspaceLogicalWorkspaceId,
  parseLogicalWorkspaceId,
} from "#product/lib/domain/workspaces/cloud/logical-workspace-id";
import { findLogicalWorkspace } from "#product/lib/domain/workspaces/cloud/logical-workspace-lookup";
import { makeCloudWorkspace } from "#product/lib/domain/workspaces/sidebar/sidebar-test-fixtures";

function makeScratchWorkspace(args: {
  id: string;
  displayName: string;
  updatedAt?: string;
}): CloudWorkspaceSummary {
  // A scratch (managed Workflow run) workspace: no repository backing, so its
  // repo/repoEnvironmentId are null and it uses the placement-neutral kind.
  return {
    ...makeCloudWorkspace({ id: args.id, updatedAt: args.updatedAt }),
    workspaceKind: "scratch",
    repo: null,
    displayName: args.displayName,
  };
}

describe("logical workspaces — scratch identity (MC5A-CLIENT-01)", () => {
  it("keeps two scratch workspaces as two distinct logical workspaces (no folding)", () => {
    const scratchA = makeScratchWorkspace({
      id: "50000000-0000-4000-8000-00000000000a",
      displayName: "Workflow run a",
      updatedAt: "2026-07-15T10:00:00.000Z",
    });
    const scratchB = makeScratchWorkspace({
      id: "50000000-0000-4000-8000-00000000000b",
      displayName: "Workflow run b",
      updatedAt: "2026-07-15T11:00:00.000Z",
    });

    const logicalWorkspaces = buildLogicalWorkspaces({
      localWorkspaces: [],
      repoRoots: [],
      cloudWorkspaces: [scratchA, scratchB],
      currentSelectionId: null,
    });

    // Two rows -> two logical workspaces (the old bug folded both into one).
    expect(logicalWorkspaces).toHaveLength(2);

    const idA = buildLogicalWorkspaceIdForCloudWorkspace(scratchA);
    const idB = buildLogicalWorkspaceIdForCloudWorkspace(scratchB);

    // Distinct selection/navigation IDs, each keyed by the real CloudWorkspace.id.
    expect(idA).toBe(buildCloudWorkspaceLogicalWorkspaceId(scratchA.id));
    expect(idB).toBe(buildCloudWorkspaceLogicalWorkspaceId(scratchB.id));
    expect(idA).not.toBe(idB);

    const parsedA = parseLogicalWorkspaceId(idA);
    expect(parsedA?.kind).toBe("cloud-workspace");
    expect(parsedA?.segments).toEqual([scratchA.id]);

    const foundA = findLogicalWorkspace(logicalWorkspaces, idA);
    const foundB = findLogicalWorkspace(logicalWorkspaces, idB);
    expect(foundA?.cloudWorkspace?.id).toBe(scratchA.id);
    expect(foundB?.cloudWorkspace?.id).toBe(scratchB.id);
    expect(foundA?.id).not.toBe(foundB?.id);

    // Cloud synthetic materialization id is per-row too (independent navigation).
    expect(foundA?.preferredMaterializationId).toBe(cloudWorkspaceSyntheticId(scratchA.id));
    expect(foundB?.preferredMaterializationId).toBe(cloudWorkspaceSyntheticId(scratchB.id));

    // Null repo metadata is never fabricated for scratch placement.
    for (const found of [foundA, foundB]) {
      expect(found?.cloudWorkspace?.repo).toBeNull();
      expect(found?.provider).toBeNull();
      expect(found?.owner).toBeNull();
      expect(found?.repoName).toBeNull();
    }
  });

  it("still keys repository worktrees by their remote identity", () => {
    const repository = makeCloudWorkspace({ id: "cloud-repo-1", branch: "feature-x" });
    const logicalId = buildLogicalWorkspaceIdForCloudWorkspace(repository);
    // Repository workspaces keep the remote identity, not the cloud-workspace kind.
    expect(parseLogicalWorkspaceId(logicalId)?.kind).toBe("remote");
  });
});
