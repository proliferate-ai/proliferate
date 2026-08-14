import { describe, expect, it } from "vitest";
import {
  buildPendingWorkspaceUiKey,
  buildSubmittingPendingWorkspaceEntry,
  type PendingWorkspaceEntry,
} from "#product/lib/domain/workspaces/creation/pending-entry";
import { buildPendingSidebarProjection } from "#product/lib/domain/workspaces/sidebar/pending-sidebar-projection";
import {
  buildGroups,
  makeCloudLogicalWorkspace,
  makeLocalLogicalWorkspace,
  makeRepoRoot,
} from "#product/lib/domain/workspaces/sidebar/sidebar-test-fixtures";

describe("pending sidebar projection", () => {
  it("leaves cowork pending rows to the dedicated Threads section", () => {
    const pendingWorkspaceEntry = buildSubmittingPendingWorkspaceEntry({
      attemptId: "attempt-cowork",
      selectedWorkspaceId: null,
      source: "cowork-created",
      displayName: "Untitled chat",
      request: {
        kind: "cowork",
        input: {
          agentKind: "codex",
          modelId: "gpt-5",
          sourceWorkspaceId: null,
        },
      },
    });

    expect(buildPendingSidebarProjection({
      entry: pendingWorkspaceEntry,
      repoRootsById: new Map(),
      selectedLogicalWorkspaceId: buildPendingWorkspaceUiKey(pendingWorkspaceEntry),
      selectedWorkspaceId: null,
      activeSessionTitle: null,
    })).toBeNull();

    expect(buildGroups({
      logicalWorkspaces: [],
      pendingWorkspaceEntries: [pendingWorkspaceEntry],
      selectedLogicalWorkspaceId: buildPendingWorkspaceUiKey(pendingWorkspaceEntry),
    })).toEqual([]);
  });

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
      pendingWorkspaceEntries: [pendingWorkspaceEntry],
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

  it("projects a first local workspace into its existing repo-root group", () => {
    const pendingWorkspaceEntry = buildSubmittingPendingWorkspaceEntry({
      attemptId: "attempt-local-1",
      selectedWorkspaceId: null,
      source: "local-created",
      displayName: "landing",
      request: {
        kind: "local",
        sourceRoot: "/tmp/landing/",
      },
    });
    const pendingWorkspaceUiKey = buildPendingWorkspaceUiKey(pendingWorkspaceEntry);
    const repoRoot = makeRepoRoot({
      id: "landing-root",
      repoName: "landing",
      sourceRoot: "/tmp/landing",
    });

    const groups = buildGroups({
      logicalWorkspaces: [],
      repoRoots: [repoRoot],
      pendingWorkspaceEntries: [pendingWorkspaceEntry],
      selectedLogicalWorkspaceId: pendingWorkspaceUiKey,
    });

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      sourceRoot: "/tmp/landing",
      name: "landing",
      repoRootId: "landing-root",
    });
    expect(groups[0]?.items).toHaveLength(1);
    expect(groups[0]?.items[0]).toMatchObject({
      id: pendingWorkspaceUiKey,
      name: "landing",
      active: true,
      variant: "local",
    });
  });

  it("keeps a materializing first local workspace in one repo group", () => {
    const pendingWorkspaceEntry = {
      ...buildSubmittingPendingWorkspaceEntry({
        attemptId: "attempt-local-1",
        selectedWorkspaceId: null,
        source: "local-created",
        displayName: "landing",
        request: {
          kind: "local" as const,
          sourceRoot: "/tmp/landing",
        },
      }),
      workspaceId: "workspace-real",
    };
    const repoRoot = makeRepoRoot({
      id: "landing-root",
      repoName: "landing",
      sourceRoot: "/tmp/landing",
    });

    const groups = buildGroups({
      logicalWorkspaces: [
        makeLocalLogicalWorkspace({
          id: "real-logical",
          workspaceId: "workspace-real",
          repoKey: "github:proliferate-ai:landing",
          repoName: "landing",
        }),
      ],
      repoRoots: [repoRoot],
      pendingWorkspaceEntries: [pendingWorkspaceEntry],
      selectedWorkspaceId: "workspace-real",
      selectedLogicalWorkspaceId: "real-logical",
    });

    expect(groups).toHaveLength(1);
    expect(groups[0]?.repoRootId).toBe("landing-root");
    expect(groups[0]?.allLogicalWorkspaceIds).toEqual(["real-logical"]);
    expect(groups[0]?.items).toHaveLength(1);
    expect(groups[0]?.items[0]).toMatchObject({
      id: "real-logical",
      name: "landing",
      active: true,
      variant: "local",
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
      pendingWorkspaceEntries: [pendingWorkspaceEntry],
      workspaceLastInteracted: {
        "repo-a-workspace": "2026-04-13T11:00:00.000Z",
      },
    });

    expect(groups.map((group) => group.name)).toEqual(["landing", "repo-a", "repo-b"]);
  });

  it("keeps the group order stable across the pending-to-materialized handoff", () => {
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
    const otherLogicalWorkspaces = [
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
    ];
    const repoRoots = [
      makeRepoRoot({
        id: "landing-root",
        repoName: "landing",
        sourceRoot: "/tmp/landing",
      }),
    ];

    const pendingGroups = buildGroups({
      logicalWorkspaces: otherLogicalWorkspaces,
      repoRoots,
      pendingWorkspaceEntries: [pendingWorkspaceEntry],
      workspaceLastInteracted: {
        "repo-a-workspace": "2026-04-13T11:00:00.000Z",
      },
    });

    const materializedGroups = buildGroups({
      logicalWorkspaces: [
        makeLocalLogicalWorkspace({
          id: "landing-gulch",
          workspaceId: "workspace-gulch",
          repoKey: "github:proliferate-ai:landing",
          repoName: "landing",
          kind: "worktree",
          branch: "gulch",
        }),
        ...otherLogicalWorkspaces,
      ],
      repoRoots,
      pendingWorkspaceEntries: [],
      workspaceLastInteracted: {
        "workspace-gulch": "2026-04-13T12:00:01.000Z",
        "repo-a-workspace": "2026-04-13T11:00:00.000Z",
      },
    });

    expect(pendingGroups.map((group) => group.name)).toEqual(["landing", "repo-a", "repo-b"]);
    expect(materializedGroups.map((group) => group.name))
      .toEqual(pendingGroups.map((group) => group.name));
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
      pendingWorkspaceEntries: [pendingWorkspaceEntry],
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
      pendingWorkspaceEntries: [pendingWorkspaceEntry],
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

describe("concurrent pending sidebar rows", () => {
  function worktreeEntry(args: {
    attemptId: string;
    displayName: string;
    repoRootId?: string;
    repoLabel?: string;
    workspaceId?: string | null;
    stage?: PendingWorkspaceEntry["stage"];
    errorMessage?: string | null;
  }): PendingWorkspaceEntry {
    return {
      ...buildSubmittingPendingWorkspaceEntry({
        attemptId: args.attemptId,
        selectedWorkspaceId: null,
        source: "worktree-created",
        displayName: args.displayName,
        repoLabel: args.repoLabel ?? "landing",
        baseBranchName: "main",
        request: {
          kind: "worktree" as const,
          input: {
            repoRootId: args.repoRootId ?? "landing-root",
            workspaceName: args.displayName,
            branchName: args.displayName,
            baseBranch: "main",
            targetPath: `/tmp/landing/${args.displayName}`,
          },
        },
      }),
      workspaceId: args.workspaceId ?? null,
      stage: args.stage ?? "submitting",
      errorMessage: args.errorMessage ?? null,
    };
  }

  const landingRepoRoot = makeRepoRoot({
    id: "landing-root",
    repoName: "landing",
    sourceRoot: "/tmp/landing",
  });

  it("renders one row per live attempt in the same repo group, in launch order", () => {
    const first = worktreeEntry({ attemptId: "attempt-1", displayName: "gulch" });
    const second = worktreeEntry({ attemptId: "attempt-2", displayName: "arroyo" });

    const groups = buildGroups({
      logicalWorkspaces: [],
      repoRoots: [landingRepoRoot],
      pendingWorkspaceEntries: [first, second],
    });

    expect(groups).toHaveLength(1);
    expect(groups[0]?.items.map((item) => item.id)).toEqual([
      buildPendingWorkspaceUiKey(first),
      buildPendingWorkspaceUiKey(second),
    ]);
    expect(groups[0]?.allLogicalWorkspaceIds).toEqual([
      buildPendingWorkspaceUiKey(first),
      buildPendingWorkspaceUiKey(second),
    ]);
  });

  it("puts pending rows ahead of the group's real workspaces", () => {
    const pending = worktreeEntry({ attemptId: "attempt-1", displayName: "gulch" });

    const groups = buildGroups({
      logicalWorkspaces: [
        makeLocalLogicalWorkspace({
          id: "landing-existing",
          workspaceId: "workspace-existing",
          repoKey: "github:proliferate-ai:landing",
          repoName: "landing",
          kind: "worktree",
          branch: "existing",
        }),
      ],
      repoRoots: [landingRepoRoot],
      pendingWorkspaceEntries: [pending],
    });

    expect(groups[0]?.items[0]?.id).toBe(buildPendingWorkspaceUiKey(pending));
    expect(groups[0]?.items).toHaveLength(2);
  });

  it("renders concurrent attempts across two repo groups", () => {
    const landing = worktreeEntry({ attemptId: "attempt-1", displayName: "gulch" });
    const other = worktreeEntry({
      attemptId: "attempt-2",
      displayName: "mesa",
      repoRootId: "docs-root",
      repoLabel: "docs",
    });

    const groups = buildGroups({
      logicalWorkspaces: [],
      repoRoots: [
        landingRepoRoot,
        makeRepoRoot({ id: "docs-root", repoName: "docs", sourceRoot: "/tmp/docs" }),
      ],
      pendingWorkspaceEntries: [landing, other],
    });

    expect(groups).toHaveLength(2);
    expect(new Map(groups.map((group) => [
      group.name,
      group.items.map((item) => item.id),
    ]))).toEqual(new Map([
      ["landing", [buildPendingWorkspaceUiKey(landing)]],
      ["docs", [buildPendingWorkspaceUiKey(other)]],
    ]));
  });

  it("carries an error indicator on a failed row and keeps it clickable", () => {
    const failed = worktreeEntry({
      attemptId: "attempt-1",
      displayName: "gulch",
      stage: "failed",
      errorMessage: "Branch already exists",
    });
    const running = worktreeEntry({ attemptId: "attempt-2", displayName: "arroyo" });

    const groups = buildGroups({
      logicalWorkspaces: [],
      repoRoots: [landingRepoRoot],
      pendingWorkspaceEntries: [failed, running],
    });

    expect(groups[0]?.items[0]?.statusIndicator).toEqual({
      kind: "error",
      tooltip: "Branch already exists",
      action: {
        kind: "open_workspace",
        workspaceId: buildPendingWorkspaceUiKey(failed),
      },
    });
    expect(groups[0]?.items[1]?.statusIndicator).toBeNull();
  });

  it("suppresses the duplicate row for an unattended attempt whose workspace landed", () => {
    // The correctness trap: this attempt is NOT selected, so suppression cannot
    // key off selection. Its real workspace is already in the collections cache
    // and sorts into the same group, and without a selection-independent rule
    // the user sees the pending row and the real row at once.
    const unattended = worktreeEntry({
      attemptId: "attempt-1",
      displayName: "gulch",
      workspaceId: "workspace-gulch",
    });

    const groups = buildGroups({
      logicalWorkspaces: [
        makeLocalLogicalWorkspace({
          id: "landing-gulch",
          workspaceId: "workspace-gulch",
          repoKey: "github:proliferate-ai:landing",
          repoName: "landing",
          kind: "worktree",
          branch: "gulch",
        }),
      ],
      repoRoots: [landingRepoRoot],
      selectedLogicalWorkspaceId: null,
      selectedWorkspaceId: null,
      pendingWorkspaceEntries: [unattended],
    });

    expect(groups[0]?.items.map((item) => item.id))
      .toEqual([buildPendingWorkspaceUiKey(unattended)]);
  });

  it("suppresses the duplicate row when the real workspace sorts into another group", () => {
    // A local launch projects into the source-root group while its created
    // workspace lands in the repo-root group, so a suppression scoped to the
    // pending row's own group would miss it entirely.
    const unattended = {
      ...buildSubmittingPendingWorkspaceEntry({
        attemptId: "attempt-1",
        selectedWorkspaceId: null,
        source: "local-created",
        displayName: "landing",
        request: { kind: "local" as const, sourceRoot: "/tmp/elsewhere" },
      }),
      workspaceId: "workspace-landing",
    };

    const groups = buildGroups({
      logicalWorkspaces: [
        makeLocalLogicalWorkspace({
          id: "landing-logical",
          workspaceId: "workspace-landing",
          repoKey: "github:proliferate-ai:landing",
          repoName: "landing",
        }),
      ],
      repoRoots: [landingRepoRoot],
      pendingWorkspaceEntries: [unattended],
    });

    const allItemIds = groups.flatMap((group) => group.items.map((item) => item.id));
    expect(allItemIds).toEqual([buildPendingWorkspaceUiKey(unattended)]);
  });
});
