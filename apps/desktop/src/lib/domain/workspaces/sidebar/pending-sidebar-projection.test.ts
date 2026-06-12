import { describe, expect, it } from "vitest";
import {
  buildPendingWorkspaceUiKey,
  buildSubmittingPendingWorkspaceEntry,
} from "@/lib/domain/workspaces/creation/pending-entry";
import { buildPendingSidebarProjection } from "./pending-sidebar-projection";
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

  it("counts pending creation as activity in the sort recency", () => {
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
    const repoRoot = makeRepoRoot({
      id: "landing-root",
      repoName: "landing",
      sourceRoot: "/tmp/landing",
    });

    const projection = buildPendingSidebarProjection({
      entry: pendingWorkspaceEntry,
      repoRootsById: new Map([[repoRoot.id, repoRoot]]),
      selectedLogicalWorkspaceId: null,
      selectedWorkspaceId: null,
      activeSessionTitle: null,
    });

    const createdAt = new Date(pendingWorkspaceEntry.createdAt).toISOString();
    expect(projection?.sortRecency).toEqual({
      activityAt: createdAt,
      recordUpdatedAt: createdAt,
      sortAt: createdAt,
      displayAt: null,
    });
  });

  it("sorts a pending workspace in a new repo group above older-activity and no-activity groups", () => {
    const pendingWorkspaceEntry = {
      ...buildSubmittingPendingWorkspaceEntry({
        attemptId: "attempt-1",
        selectedWorkspaceId: null,
        source: "worktree-created",
        displayName: "gulch",
        repoLabel: "landing",
        baseBranchName: "main",
        request: {
          kind: "worktree" as const,
          input: {
            repoRootId: "landing-root",
            workspaceName: "gulch",
            branchName: "gulch",
            baseBranch: "main",
            targetPath: "/tmp/landing/gulch",
          },
        },
      }),
      createdAt: Date.parse("2026-04-13T12:00:00.000Z"),
    };

    const groups = buildGroups({
      logicalWorkspaces: [
        makeLocalLogicalWorkspace({
          id: "repo-a-workspace",
          repoKey: "/tmp/repo-a",
          repoName: "repo-a",
        }),
        makeLocalLogicalWorkspace({
          id: "repo-b-workspace",
          repoKey: "/tmp/repo-b",
          repoName: "repo-b",
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
      workspaceLastInteracted: {
        "repo-a-workspace": "2026-04-13T11:00:00.000Z",
      },
    });

    expect(groups.map((group) => group.name)).toEqual(["landing", "repo-a", "repo-b"]);
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
