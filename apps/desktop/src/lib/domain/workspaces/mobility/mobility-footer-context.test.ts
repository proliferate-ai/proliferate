import { describe, expect, it } from "vitest";
import type { LogicalWorkspace } from "@/lib/domain/workspaces/cloud/logical-workspace-model";
import {
  buildPendingMobilityFooterContext,
  buildMobilityFooterContext,
  workspaceMobilitySelectedMaterializationKindFromWorkspaceId,
  type WorkspaceMobilitySelectedMaterializationKind,
} from "@/lib/domain/workspaces/mobility/mobility-footer-context";
import {
  buildSubmittingPendingWorkspaceEntry,
} from "@/lib/domain/workspaces/creation/pending-entry";
import {
  mobilityDestinationKind,
  type WorkspaceMobilityStatusModel,
} from "@/lib/domain/workspaces/mobility/mobility-state-machine";

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
  it("labels local workspaces", () => {
    const context = buildMobilityFooterContext({
      logicalWorkspace: makeLogicalWorkspace(),
      status: makeStatus(),
    });

    expect(context).toMatchObject({
      locationLabel: "Local workspace",
      movementLabel: "Move to cloud",
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

    expect(context).toMatchObject({
      locationLabel: "Local worktree",
      movementLabel: "Move to cloud",
    });
  });

  it("labels cloud workspaces even when a local repo root exists", () => {
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
          readyAt: "2026-04-14T00:00:00Z",
          repo: {
            provider: "github",
            owner: "openai",
            name: "proliferate",
            baseBranch: "main",
            branch: "feature/workspace-mobility",
          },
          visibility: "private",
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
      movementLabel: "Bring back local",
    });
  });

  it("labels mobility workspaces owned by cloud", () => {
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
      movementLabel: "Bring back local",
    });
  });

  it("uses the SSH target variant and appearance for direct-target cloud workspaces", () => {
    const context = buildMobilityFooterContext({
      logicalWorkspace: makeLogicalWorkspace({
        cloudWorkspace: {
          id: "cloud-ssh-1",
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
          readyAt: "2026-04-14T00:00:00Z",
          repo: {
            provider: "github",
            owner: "openai",
            name: "proliferate",
            baseBranch: "main",
            branch: "feature/workspace-mobility",
          },
          visibility: "private",
          sandboxType: "ssh",
          directTargetContext: {
            targetId: "ssh-target-1",
            targetKind: "ssh",
            anyharnessWorkspaceId: "workspace-ssh-1",
          },
        },
        effectiveOwner: "cloud",
        lifecycle: "ssh_active",
        localWorkspace: null,
      }),
      status: makeStatus(),
      targetAppearanceById: {
        "ssh-target-1": {
          displayName: "Pop OS",
          iconId: "terminal",
          iconLabel: "Terminal",
          colorId: "blue",
          colorLabel: "Blue",
          colorValue: "#4a72b5",
        },
      },
    });

    expect(context).toMatchObject({
      locationLabel: "Cloud workspace",
      movementLabel: "Bring back local",
      variant: "ssh",
      targetAppearance: {
        displayName: "Pop OS",
      },
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

  it("keeps the location control interactive during background cleanup", () => {
    const context = buildMobilityFooterContext({
      logicalWorkspace: makeLogicalWorkspace(),
      status: makeStatus({
        direction: "cloud_to_local",
        phase: "cleanup_pending",
        isBlocking: false,
      }),
    });

    expect(context?.isInteractive).toBe(true);
    expect(context?.isActive).toBe(false);
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
    expect(context?.isActive).toBe(false);
  });

  it("builds footer context for pending local, worktree, and cloud workspaces", () => {
    const local = buildPendingMobilityFooterContext(buildSubmittingPendingWorkspaceEntry({
      attemptId: "local-attempt",
      selectedWorkspaceId: null,
      source: "local-created",
      displayName: "proliferate",
      request: { kind: "local", sourceRoot: "/Users/pablo/proliferate" },
    }));
    const worktree = buildPendingMobilityFooterContext(buildSubmittingPendingWorkspaceEntry({
      attemptId: "worktree-attempt",
      selectedWorkspaceId: null,
      source: "worktree-created",
      displayName: "workspace-abc",
      repoLabel: "proliferate",
      baseBranchName: "main",
      request: {
        kind: "worktree",
        input: {
          repoRootId: "repo-root",
          workspaceName: "workspace-abc",
          branchName: "pablo/workspace-abc",
          baseBranch: "main",
          targetPath: "/Users/pablo/.proliferate/worktrees/proliferate/workspace-abc",
        },
      },
    }));
    const cloud = buildPendingMobilityFooterContext(buildSubmittingPendingWorkspaceEntry({
      attemptId: "cloud-attempt",
      selectedWorkspaceId: null,
      source: "cloud-created",
      displayName: "workspace-cloud",
      repoLabel: "proliferate-ai/proliferate",
      baseBranchName: "main",
      request: {
        kind: "cloud",
        input: {
          gitProvider: "github",
          gitOwner: "proliferate-ai",
          gitRepoName: "proliferate",
          baseBranch: "main",
          branchName: "pablo/workspace-cloud",
          ownerScope: "personal",
        },
      },
    }));

    expect(local).toMatchObject({
      locationLabel: "Local workspace",
      isInteractive: false,
      isActive: true,
    });
    expect(worktree).toMatchObject({
      locationLabel: "Local worktree",
      isInteractive: false,
      isActive: true,
    });
    expect(cloud).toMatchObject({
      locationLabel: "Cloud workspace",
      isInteractive: false,
      isActive: true,
    });
  });

  it("treats cloud and direct-target synthetic ids as cloud materializations", () => {
    expect(workspaceMobilitySelectedMaterializationKindFromWorkspaceId(null)).toBeNull();
    expect(workspaceMobilitySelectedMaterializationKindFromWorkspaceId("workspace-1")).toBe("local");
    expect(workspaceMobilitySelectedMaterializationKindFromWorkspaceId("cloud:cloud-1")).toBe("cloud");
    expect(workspaceMobilitySelectedMaterializationKindFromWorkspaceId("target:ssh-1:workspace-1")).toBe("cloud");
  });

  it("does not build a footer context for pending cowork threads", () => {
    const entry = buildSubmittingPendingWorkspaceEntry({
      attemptId: "cowork-attempt",
      selectedWorkspaceId: null,
      source: "cowork-created",
      displayName: "Cowork thread",
      request: {
        kind: "cowork",
        input: {
          agentKind: "claude",
          modelId: "claude-sonnet-4.5",
          modeId: "bypassPermissions",
          draftText: null,
          sourceWorkspaceId: null,
        },
      },
    });

    expect(buildPendingMobilityFooterContext(entry)).toBeNull();
    expect(buildPendingMobilityFooterContext({
      ...entry,
      workspaceId: "workspace-cowork",
      request: { kind: "select-existing", workspaceId: "workspace-cowork" },
    })).toBeNull();
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
