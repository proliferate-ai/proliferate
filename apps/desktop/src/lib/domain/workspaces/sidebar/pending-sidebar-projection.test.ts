import { describe, expect, it } from "vitest";
import {
  buildPendingWorkspaceUiKey,
  buildSubmittingPendingWorkspaceEntry,
} from "@/lib/domain/workspaces/creation/pending-entry";
import {
  buildGroups,
  makeCloudLogicalWorkspace,
  makeLocalLogicalWorkspace,
  makeRepoRoot,
} from "./sidebar-test-fixtures";

describe("pending sidebar projection", () => {
  it("projects a pending worktree into its repo group before materialization", () => {
    const pendingWorkspaceEntry = buildSubmittingPendingWorkspaceEntry({
      attemptId: "attempt-1",
      selectedWorkspaceId: null,
      source: "worktree-created",
      displayName: "gulch",
      repoLabel: "landing",
      baseBranchName: "main",
      request: {
        kind: "worktree",
        input: {
          repoRootId: "landing-root",
          workspaceName: "gulch",
          branchName: "gulch",
          baseBranch: "main",
          targetPath: "/tmp/landing/gulch",
        },
      },
    });
    const pendingWorkspaceUiKey = buildPendingWorkspaceUiKey(pendingWorkspaceEntry);
    const groups = buildGroups({
      logicalWorkspaces: [],
      repoRoots: [
        makeRepoRoot({
          id: "landing-root",
          repoName: "landing",
          sourceRoot: "/tmp/landing",
        }),
      ],
      pendingWorkspaceEntry,
      selectedLogicalWorkspaceId: pendingWorkspaceUiKey,
    });

    expect(groups).toHaveLength(1);
    expect(groups[0]?.sourceRoot).toBe("/tmp/landing");
    expect(groups[0]?.items).toHaveLength(1);
    expect(groups[0]?.items[0]).toMatchObject({
      id: pendingWorkspaceUiKey,
      name: "gulch",
      defaultName: "gulch",
      active: true,
      variant: "worktree",
      localWorkspaceId: null,
      renameSupported: false,
      lastInteracted: new Date(pendingWorkspaceEntry.createdAt).toISOString(),
    });
  });

  it("uses the real logical id for a pending worktree during materialization handoff", () => {
    const pendingWorkspaceEntry = {
      ...buildSubmittingPendingWorkspaceEntry({
        attemptId: "attempt-1",
        selectedWorkspaceId: null,
        source: "worktree-created",
        displayName: "papaya",
        repoLabel: "landing",
        baseBranchName: "main",
        request: {
          kind: "worktree" as const,
          input: {
            repoRootId: "landing-root",
            workspaceName: "papaya",
            branchName: "papaya",
            baseBranch: "main",
            targetPath: "/tmp/landing/papaya",
          },
        },
      }),
      workspaceId: "workspace-real",
    };

    const groups = buildGroups({
      logicalWorkspaces: [
        makeLocalLogicalWorkspace({
          id: "real-logical",
          workspaceId: "workspace-real",
          repoKey: "github:proliferate-ai:landing",
          repoName: "landing",
          kind: "worktree",
          branch: "papaya",
        }),
      ],
      repoRoots: [
        makeRepoRoot({
          id: "landing-root",
          repoName: "landing",
          sourceRoot: "/tmp/landing",
        }),
      ],
      pendingWorkspaceEntry,
      selectedWorkspaceId: "workspace-real",
      selectedLogicalWorkspaceId: "real-logical",
    });

    expect(groups).toHaveLength(1);
    expect(groups[0]?.items).toHaveLength(1);
    expect(groups[0]?.allLogicalWorkspaceIds).toEqual(["real-logical"]);
    expect(groups[0]?.items[0]).toMatchObject({
      id: "real-logical",
      name: "papaya",
      defaultName: "papaya",
      active: true,
      variant: "worktree",
      localWorkspaceId: null,
      renameSupported: false,
    });
  });

  it("keeps a cloud-created select-existing pending row cloud-shaped during handoff", () => {
    const pendingWorkspaceEntry = {
      ...buildSubmittingPendingWorkspaceEntry({
        attemptId: "attempt-1",
        selectedWorkspaceId: null,
        source: "cloud-created",
        displayName: "feature-branch",
        repoLabel: "proliferate-ai/proliferate",
        baseBranchName: "main",
        request: {
          kind: "select-existing" as const,
          workspaceId: "cloud:cloud-1",
        },
      }),
      stage: "awaiting-cloud-ready" as const,
      workspaceId: "cloud:cloud-1",
    };

    const groups = buildGroups({
      logicalWorkspaces: [
        makeCloudLogicalWorkspace({
          id: "logical-cloud",
          cloudWorkspaceId: "cloud-1",
          repoKey: "github:proliferate-ai:proliferate",
          repoName: "proliferate",
          branch: "feature-branch",
        }),
      ],
      pendingWorkspaceEntry,
      selectedWorkspaceId: "cloud:cloud-1",
      selectedLogicalWorkspaceId: null,
    });

    expect(groups).toHaveLength(1);
    expect(groups[0]?.sourceRoot).toBe("github:proliferate-ai:proliferate");
    expect(groups[0]?.items).toHaveLength(1);
    expect(groups[0]?.allLogicalWorkspaceIds).toEqual([
      buildPendingWorkspaceUiKey(pendingWorkspaceEntry),
    ]);
    expect(groups[0]?.items[0]).toMatchObject({
      id: buildPendingWorkspaceUiKey(pendingWorkspaceEntry),
      name: "feature-branch",
      active: true,
      variant: "cloud",
      cloudWorkspaceId: "cloud-1",
      localWorkspaceId: null,
      renameSupported: false,
    });
  });
});
