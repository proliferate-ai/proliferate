import { describe, expect, it } from "vitest";
import {
  buildPendingWorkspaceUiKey,
  buildSubmittingPendingWorkspaceEntry,
} from "@/lib/domain/workspaces/creation/pending-entry";
import {
  buildGroups,
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
});
