import { describe, expect, it } from "vitest";
import type { LogicalWorkspace } from "@/lib/domain/workspaces/logical-workspaces";
import {
  buildMobilityFooterContext,
  type WorkspaceMobilitySelectedMaterializationKind,
} from "@/lib/domain/workspaces/mobility-footer-context";
import {
  mobilityDestinationKind,
  type WorkspaceMobilityStatusModel,
} from "@/lib/domain/workspaces/mobility-state-machine";

function makeStatus(overrides: Partial<WorkspaceMobilityStatusModel> = {}): WorkspaceMobilityStatusModel {
  return {
    direction: null,
    phase: "idle",
    activeHandoff: null,
    title: null,
    description: null,
    isBlocking: false,
    isFailure: false,
    canRetryCleanup: false,
    ...overrides,
  };
}

function makeLogicalWorkspace(overrides: Partial<LogicalWorkspace> = {}): LogicalWorkspace {
  return {
    id: "remote:github:openai:proliferate:feature%2Fmobility",
    repoKey: "github:openai:proliferate",
    sourceRoot: "/Users/pablo/proliferate",
    repoRoot: {
      id: "repo-root",
      path: "/Users/pablo/proliferate",
    } as LogicalWorkspace["repoRoot"],
    provider: "github",
    owner: "openai",
    repoName: "proliferate",
    branchKey: "feature/workspace-mobility",
    displayName: "Workspace Mobility",
    localWorkspace: {
      id: "workspace-1",
      kind: "workspace",
      path: "/Users/pablo/proliferate",
      sourceRepoRootPath: "/Users/pablo/proliferate",
      currentBranch: "feature/workspace-mobility",
      updatedAt: "2026-04-14T00:00:00Z",
    } as unknown as LogicalWorkspace["localWorkspace"],
    cloudWorkspace: null,
    mobilityWorkspace: null,
    preferredMaterializationId: "workspace-1",
    effectiveOwner: "local",
    lifecycle: "local_active",
    updatedAt: "2026-04-14T00:00:00Z",
    ...overrides,
  };
}

function makeMobilityWorkspace(): NonNullable<LogicalWorkspace["mobilityWorkspace"]> {
  return {
    id: "mobility-1",
    displayName: "Mobility Display",
    repo: {
      provider: "github",
      owner: "proliferate-ai",
      name: "proliferate",
      branch: "feature/workspace-mobility",
    },
    owner: "cloud",
    lifecycleState: "cloud_active",
    statusDetail: null,
    lastError: null,
    cloudWorkspaceId: "cloud-1",
    cloudLostAt: null,
    cloudLostReason: null,
    activeHandoff: null,
    updatedAt: "2026-04-14T00:00:00Z",
    createdAt: "2026-04-14T00:00:00Z",
  };
}

describe("buildMobilityFooterContext", () => {
  it("labels local workspaces with their local path and branch", () => {
    const context = buildMobilityFooterContext({
      logicalWorkspace: makeLogicalWorkspace(),
      status: makeStatus(),
    });

    expect(context).toMatchObject({
      locationLabel: "Local workspace",
      detailKind: "path",
      detailValue: "/Users/pablo/proliferate",
      detailCopyLabel: "Path",
      branchLabel: "feature/workspace-mobility",
    });
  });

  it("labels local worktrees distinctly", () => {
    const context = buildMobilityFooterContext({
      logicalWorkspace: makeLogicalWorkspace({
        localWorkspace: {
          id: "workspace-2",
          kind: "worktree",
          path: "/Users/pablo/proliferate-worktree",
          sourceRepoRootPath: "/Users/pablo/proliferate",
          currentBranch: "feature/workspace-mobility",
          updatedAt: "2026-04-14T00:00:00Z",
        } as unknown as LogicalWorkspace["localWorkspace"],
      }),
      status: makeStatus(),
    });

    expect(context?.locationLabel).toBe("Local worktree");
    expect(context).toMatchObject({
      detailKind: "path",
      detailValue: "/Users/pablo/proliferate-worktree",
      detailCopyLabel: "Path",
    });
  });

  it("uses repository identity for cloud workspaces even when a local repo root exists", () => {
    const context = buildMobilityFooterContext({
      logicalWorkspace: makeLogicalWorkspace({
        cloudWorkspace: {
          id: "cloud-1",
          displayName: null,
          actionBlockKind: null,
          actionBlockReason: null,
          postReadyPhase: "idle",
          postReadyFilesApplied: 0,
          postReadyFilesTotal: 0,
          postReadyStartedAt: null,
          postReadyCompletedAt: null,
          status: "ready",
          workspaceStatus: "ready",
          runtime: {
            environmentId: "runtime-1",
            status: "running",
            generation: 1,
            actionBlockKind: null,
            actionBlockReason: null,
          },
          statusDetail: null,
          lastError: null,
          templateVersion: "v1",
          createdAt: "2026-04-14T00:00:00Z",
          updatedAt: "2026-04-14T00:00:00Z",
          repo: {
            provider: "github",
            owner: "openai",
            name: "proliferate",
            baseBranch: "main",
            branch: "feature/workspace-mobility",
          },
        },
        effectiveOwner: "cloud",
        lifecycle: "cloud_active",
        localWorkspace: null,
      }),
      status: makeStatus({
        direction: "local_to_cloud",
        phase: "success",
      }),
    });

    expect(context).toMatchObject({
      locationLabel: "Cloud workspace",
      detailKind: "repository",
      detailValue: "openai/proliferate",
      detailCopyLabel: "Repository",
    });
  });

  it("uses mobility workspace repo metadata for cloud workspace identity", () => {
    const context = buildMobilityFooterContext({
      logicalWorkspace: makeLogicalWorkspace({
        cloudWorkspace: null,
        effectiveOwner: "cloud",
        lifecycle: "cloud_active",
        localWorkspace: null,
        mobilityWorkspace: makeMobilityWorkspace(),
        owner: null,
        repoName: null,
      }),
      status: makeStatus(),
    });

    expect(context).toMatchObject({
      locationLabel: "Cloud workspace",
      detailKind: "repository",
      detailValue: "proliferate-ai/proliferate",
      detailCopyLabel: "Repository",
    });
  });

  it("keeps the location control interactive even for non-repo workspaces", () => {
    const context = buildMobilityFooterContext({
      logicalWorkspace: makeLogicalWorkspace({
        provider: null,
        owner: null,
        repoName: null,
      }),
      status: makeStatus(),
    });

    expect(context?.isInteractive).toBe(true);
  });

  it("disables the location control while a workspace move is in progress", () => {
    const context = buildMobilityFooterContext({
      logicalWorkspace: makeLogicalWorkspace(),
      status: makeStatus({
        direction: "local_to_cloud",
        phase: "transferring",
        isBlocking: true,
      }),
    });

    expect(context?.isInteractive).toBe(false);
    expect(context?.isActive).toBe(true);
  });

  it("keeps cleanup failures interactive for retry", () => {
    const context = buildMobilityFooterContext({
      logicalWorkspace: makeLogicalWorkspace(),
      status: makeStatus({
        direction: "local_to_cloud",
        phase: "cleanup_failed",
        isFailure: true,
        canRetryCleanup: true,
      }),
    });

    expect(context?.isInteractive).toBe(true);
    expect(context?.isActive).toBe(true);
  });

  it.each<{
    effectiveOwner: LogicalWorkspace["effectiveOwner"];
    expected: string;
    localKind: "workspace" | "worktree";
    selectedMaterializationKind: WorkspaceMobilitySelectedMaterializationKind | null;
    status: WorkspaceMobilityStatusModel;
  }>([
    {
      effectiveOwner: "local",
      expected: "Cloud workspace",
      localKind: "worktree",
      selectedMaterializationKind: "local",
      status: makeStatus({
        direction: "local_to_cloud",
        isBlocking: true,
        phase: "transferring",
      }),
    },
    {
      effectiveOwner: "cloud",
      expected: "Local worktree",
      localKind: "worktree",
      selectedMaterializationKind: "cloud",
      status: makeStatus({
        direction: "cloud_to_local",
        isBlocking: true,
        phase: "transferring",
      }),
    },
    {
      effectiveOwner: "local",
      expected: "Cloud workspace",
      localKind: "worktree",
      selectedMaterializationKind: "cloud",
      status: makeStatus(),
    },
    {
      effectiveOwner: "cloud",
      expected: "Local worktree",
      localKind: "worktree",
      selectedMaterializationKind: "local",
      status: makeStatus(),
    },
    {
      effectiveOwner: "cloud",
      expected: "Cloud workspace",
      localKind: "workspace",
      selectedMaterializationKind: null,
      status: makeStatus(),
    },
    {
      effectiveOwner: "local",
      expected: "Local workspace",
      localKind: "workspace",
      selectedMaterializationKind: null,
      status: makeStatus(),
    },
  ])(
    "resolves $expected from blocking, selection, then effective owner precedence",
    ({ effectiveOwner, expected, localKind, selectedMaterializationKind, status }) => {
      const context = buildMobilityFooterContext({
        logicalWorkspace: makeLogicalWorkspace({
          effectiveOwner,
          localWorkspace: {
            id: "workspace-matrix",
            kind: localKind,
            path: "/Users/pablo/proliferate-matrix",
            sourceRepoRootPath: "/Users/pablo/proliferate",
            currentBranch: "feature/workspace-mobility",
            updatedAt: "2026-04-14T00:00:00Z",
          } as unknown as LogicalWorkspace["localWorkspace"],
        }),
        selectedMaterializationKind,
        status,
      });

      expect(context?.locationLabel).toBe(expected);
    },
  );
});

describe("mobilityDestinationKind", () => {
  it("maps blocking directions to the destination runtime", () => {
    expect(mobilityDestinationKind({
      direction: "local_to_cloud",
      isBlocking: true,
    })).toBe("cloud");
    expect(mobilityDestinationKind({
      direction: "cloud_to_local",
      isBlocking: true,
    })).toBe("local");
  });

  it("ignores non-blocking statuses", () => {
    expect(mobilityDestinationKind({
      direction: "local_to_cloud",
      isBlocking: false,
    })).toBeNull();
  });
});
