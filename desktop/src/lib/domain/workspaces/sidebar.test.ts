import { describe, expect, it } from "vitest";
import {
  DEFAULT_SIDEBAR_WORKSPACE_TYPES,
  resolveAutoShowMoreRepoKey,
  resolveSidebarEmptyState,
  resolveSidebarWorkspaceTypes,
  toggleSidebarWorkspaceTypeSelection,
} from "./sidebar";
import {
  buildGroups,
  makeCloudLogicalWorkspace,
  makeLocalLogicalWorkspace,
  makeRepoRoot,
} from "./sidebar-test-fixtures";

describe("repo-root seeded groups", () => {
  it("shows zero-workspace repo roots in the sidebar", () => {
    const groups = buildGroups({
      logicalWorkspaces: [],
      repoRoots: [
        makeRepoRoot({
          id: "repo-root-empty",
          repoName: "empty-repo",
          sourceRoot: "/tmp/empty-repo",
        }),
      ],
    });

    expect(groups).toHaveLength(1);
    expect(groups[0]?.sourceRoot).toBe("/tmp/empty-repo");
    expect(groups[0]?.repoRootId).toBe("repo-root-empty");
    expect(groups[0]?.items).toEqual([]);
  });

  it("keeps a repo-root-backed group when all matching workspaces are archived", () => {
    const groups = buildGroups({
      logicalWorkspaces: [
        makeLocalLogicalWorkspace({
          id: "archived-workspace",
          repoKey: "github:proliferate-ai:repo-a",
          repoName: "repo-a",
        }),
      ],
      repoRoots: [
        makeRepoRoot({
          id: "repo-a-root",
          repoName: "repo-a",
          sourceRoot: "/tmp/repo-a",
        }),
      ],
      archivedIds: ["archived-workspace"],
    });

    expect(groups).toHaveLength(1);
    expect(groups[0]?.sourceRoot).toBe("/tmp/repo-a");
    expect(groups[0]?.repoRootId).toBe("repo-a-root");
    expect(groups[0]?.items).toEqual([]);
    expect(groups[0]?.allLogicalWorkspaceIds).toEqual(["archived-workspace"]);
  });

  it("still drops repo-root-backed groups when workspace type filters hide every item", () => {
    const groups = buildGroups({
      logicalWorkspaces: [
        makeLocalLogicalWorkspace({
          id: "worktree-hidden-by-type",
          repoKey: "github:proliferate-ai:repo-a",
          repoName: "repo-a",
          kind: "worktree",
        }),
      ],
      repoRoots: [
        makeRepoRoot({
          id: "repo-a-root",
          repoName: "repo-a",
          sourceRoot: "/tmp/repo-a",
        }),
      ],
      workspaceTypes: ["cloud"],
    });

    expect(groups).toHaveLength(0);
  });
});

describe("sidebar workspace filters", () => {
  it("shows all non-archived entries for the default workspace types", () => {
    const groups = buildGroups({
      logicalWorkspaces: [
        makeLocalLogicalWorkspace({
          id: "local-1",
          repoKey: "/tmp/repo-a",
          repoName: "repo-a",
        }),
        makeLocalLogicalWorkspace({
          id: "worktree-1",
          repoKey: "/tmp/repo-a",
          repoName: "repo-a",
          kind: "worktree",
          branch: "feature/worktree-1",
        }),
        makeCloudLogicalWorkspace({
          id: "cloud-1",
          repoKey: "/tmp/repo-b",
          repoName: "repo-b",
        }),
      ],
      archivedIds: ["local-1"],
    });

    expect(groups).toHaveLength(2);
    expect(groups[0]?.items.map((item) => item.id)).toEqual(["worktree-1"]);
    expect(groups[1]?.items.map((item) => item.id)).toEqual(["cloud-1"]);
  });

  it.each([
    { variant: "local" as const, expectedIds: ["local-1"] },
    { variant: "worktree" as const, expectedIds: ["worktree-1"] },
    { variant: "cloud" as const, expectedIds: ["cloud-1"] },
  ])("filters to $variant workspaces only", ({ variant, expectedIds }) => {
    const groups = buildGroups({
      logicalWorkspaces: [
        makeLocalLogicalWorkspace({
          id: "local-1",
          repoKey: "/tmp/repo-a",
          repoName: "repo-a",
        }),
        makeLocalLogicalWorkspace({
          id: "worktree-1",
          repoKey: "/tmp/repo-a",
          repoName: "repo-a",
          kind: "worktree",
          branch: "feature/worktree-1",
        }),
        makeCloudLogicalWorkspace({
          id: "cloud-1",
          repoKey: "/tmp/repo-b",
          repoName: "repo-b",
        }),
      ],
      workspaceTypes: [variant],
    });

    expect(groups.flatMap((group) => group.items.map((item) => item.variant))).toEqual([variant]);
    expect(groups.flatMap((group) => group.items.map((item) => item.id))).toEqual(expectedIds);
  });

  it("keeps matching items in mixed groups and drops groups that become empty", () => {
    const groups = buildGroups({
      logicalWorkspaces: [
        makeLocalLogicalWorkspace({
          id: "local-visible",
          repoKey: "/tmp/repo-a",
          repoName: "repo-a",
        }),
        makeCloudLogicalWorkspace({
          id: "cloud-hidden",
          repoKey: "/tmp/repo-a",
          repoName: "repo-a",
        }),
        makeCloudLogicalWorkspace({
          id: "cloud-only",
          repoKey: "/tmp/repo-b",
          repoName: "repo-b",
        }),
      ],
      workspaceTypes: ["local"],
    });

    expect(groups).toHaveLength(1);
    expect(groups[0]?.sourceRoot).toBe("/tmp/repo-a");
    expect(groups[0]?.items.map((item) => item.id)).toEqual(["local-visible"]);
  });

  it("keeps the selected logical workspace visible when it does not match the type filter", () => {
    const groups = buildGroups({
      logicalWorkspaces: [
        makeLocalLogicalWorkspace({
          id: "local-visible",
          repoKey: "/tmp/repo-a",
          repoName: "repo-a",
        }),
        makeCloudLogicalWorkspace({
          id: "cloud-selected",
          repoKey: "/tmp/repo-a",
          repoName: "repo-a",
        }),
      ],
      workspaceTypes: ["local"],
      selectedLogicalWorkspaceId: "cloud-selected",
    });

    expect(groups).toHaveLength(1);
    expect(groups[0]?.items.map((item) => item.id)).toEqual([
      "local-visible",
      "cloud-selected",
    ]);
    expect(groups[0]?.items[1]?.active).toBe(true);
  });

  it("keeps the selected logical workspace visible when it is archived", () => {
    const groups = buildGroups({
      logicalWorkspaces: [
        makeLocalLogicalWorkspace({
          id: "local-visible",
          repoKey: "/tmp/repo-a",
          repoName: "repo-a",
        }),
        makeLocalLogicalWorkspace({
          id: "archived-selected",
          repoKey: "/tmp/repo-a",
          repoName: "repo-a",
          kind: "worktree",
          branch: "feature/archived-selected",
        }),
      ],
      archivedIds: ["archived-selected"],
      selectedLogicalWorkspaceId: "archived-selected",
    });

    expect(groups).toHaveLength(1);
    expect(groups[0]?.items.map((item) => item.id)).toEqual([
      "local-visible",
      "archived-selected",
    ]);
    expect(groups[0]?.items[1]?.archived).toBe(true);
    expect(groups[0]?.items[1]?.active).toBe(true);
  });

  it("composes archived visibility with workspace-type filtering", () => {
    const logicalWorkspaces = [
      makeLocalLogicalWorkspace({
        id: "local-1",
        repoKey: "/tmp/repo-a",
        repoName: "repo-a",
      }),
      makeLocalLogicalWorkspace({
        id: "worktree-archived",
        repoKey: "/tmp/repo-a",
        repoName: "repo-a",
        kind: "worktree",
        branch: "feature/worktree-archived",
      }),
      makeCloudLogicalWorkspace({
        id: "cloud-1",
        repoKey: "/tmp/repo-b",
        repoName: "repo-b",
      }),
    ];

    const hiddenArchivedGroups = buildGroups({
      logicalWorkspaces,
      workspaceTypes: ["worktree"],
      archivedIds: ["worktree-archived"],
    });
    const visibleArchivedGroups = buildGroups({
      logicalWorkspaces,
      showArchived: true,
      workspaceTypes: ["worktree"],
      archivedIds: ["worktree-archived"],
    });

    expect(hiddenArchivedGroups).toHaveLength(0);
    expect(visibleArchivedGroups).toHaveLength(1);
    expect(visibleArchivedGroups[0]?.items.map((item) => item.id)).toEqual(["worktree-archived"]);
  });

  it("preserves the full repo workspace id list even when visible items are filtered", () => {
    const groups = buildGroups({
      logicalWorkspaces: [
        makeLocalLogicalWorkspace({
          id: "local-visible",
          repoKey: "/tmp/repo-a",
          repoName: "repo-a",
        }),
        makeCloudLogicalWorkspace({
          id: "cloud-hidden",
          repoKey: "/tmp/repo-a",
          repoName: "repo-a",
        }),
      ],
      workspaceTypes: ["local"],
    });

    expect(groups[0]?.items.map((item) => item.id)).toEqual(["local-visible"]);
    expect(groups[0]?.allLogicalWorkspaceIds).toEqual([
      "local-visible",
      "cloud-hidden",
    ]);
  });

  it("orders workspace items by work activity before record freshness", () => {
    const groups = buildGroups({
      logicalWorkspaces: [
        makeLocalLogicalWorkspace({
          id: "renamed-but-older-work",
          repoKey: "/tmp/repo-a",
          repoName: "repo-a",
          kind: "worktree",
          updatedAt: "2026-04-13T12:00:00.000Z",
        }),
        makeLocalLogicalWorkspace({
          id: "older-record-newer-work",
          repoKey: "/tmp/repo-a",
          repoName: "repo-a",
          kind: "worktree",
          updatedAt: "2026-04-13T11:00:00.000Z",
        }),
      ],
      workspaceLastInteracted: {
        "renamed-but-older-work": "2026-04-13T10:00:00.000Z",
        "older-record-newer-work": "2026-04-13T11:30:00.000Z",
      },
    });

    expect(groups[0]?.items.map((item) => item.id)).toEqual([
      "older-record-newer-work",
      "renamed-but-older-work",
    ]);
    expect(groups[0]?.items.map((item) => item.lastInteracted)).toEqual([
      "2026-04-13T11:30:00.000Z",
      "2026-04-13T10:00:00.000Z",
    ]);
  });

  it("orders repo groups by their latest visible work activity", () => {
    const groups = buildGroups({
      logicalWorkspaces: [
        makeLocalLogicalWorkspace({
          id: "repo-a-workspace",
          repoKey: "/tmp/repo-a",
          repoName: "repo-a",
          updatedAt: "2026-04-13T12:00:00.000Z",
        }),
        makeLocalLogicalWorkspace({
          id: "repo-b-workspace",
          repoKey: "/tmp/repo-b",
          repoName: "repo-b",
          updatedAt: "2026-04-13T11:00:00.000Z",
        }),
      ],
      workspaceLastInteracted: {
        "repo-a-workspace": "2026-04-13T10:00:00.000Z",
        "repo-b-workspace": "2026-04-13T11:30:00.000Z",
      },
    });

    expect(groups.map((group) => group.name)).toEqual(["repo-b", "repo-a"]);
  });

  it("ignores type-hidden workspace activity when ordering visible repo groups", () => {
    const groups = buildGroups({
      logicalWorkspaces: [
        makeLocalLogicalWorkspace({
          id: "repo-a-visible",
          repoKey: "/tmp/repo-a",
          repoName: "repo-a",
          updatedAt: "2026-04-13T09:00:00.000Z",
        }),
        makeCloudLogicalWorkspace({
          id: "repo-a-hidden-cloud",
          repoKey: "/tmp/repo-a",
          repoName: "repo-a",
          updatedAt: "2026-04-13T09:00:00.000Z",
        }),
        makeLocalLogicalWorkspace({
          id: "repo-b-visible",
          repoKey: "/tmp/repo-b",
          repoName: "repo-b",
          updatedAt: "2026-04-13T09:00:00.000Z",
        }),
      ],
      workspaceTypes: ["local"],
      workspaceLastInteracted: {
        "repo-a-visible": "2026-04-13T10:00:00.000Z",
        "repo-a-hidden-cloud": "2026-04-13T12:00:00.000Z",
        "repo-b-visible": "2026-04-13T11:00:00.000Z",
      },
    });

    expect(groups.map((group) => group.name)).toEqual(["repo-b", "repo-a"]);
    expect(groups[1]?.items.map((item) => item.id)).toEqual(["repo-a-visible"]);
  });

  it("resolves a repo key when the selected logical workspace is past the item cap", () => {
    const groups = buildGroups({
      logicalWorkspaces: Array.from({ length: 7 }, (_, index) =>
        makeLocalLogicalWorkspace({
          id: `worktree-${index}`,
          repoKey: "/tmp/repo-a",
          repoName: "repo-a",
          kind: "worktree",
          branch: `feature/worktree-${index}`,
          updatedAt: `2026-04-13T10:0${index}:00.000Z`,
        })),
      selectedLogicalWorkspaceId: "worktree-6",
    });

    const repoKey = resolveAutoShowMoreRepoKey({
      groups,
      selectedLogicalWorkspaceId: "worktree-6",
      itemLimit: 6,
    });

    expect(repoKey).toBe("/tmp/repo-a");
  });

  it("does not resolve a repo key when no logical workspace is selected", () => {
    const groups = buildGroups({
      logicalWorkspaces: Array.from({ length: 7 }, (_, index) =>
        makeLocalLogicalWorkspace({
          id: `worktree-${index}`,
          repoKey: "/tmp/repo-a",
          repoName: "repo-a",
          kind: "worktree",
          branch: `feature/worktree-${index}`,
          updatedAt: `2026-04-13T10:0${index}:00.000Z`,
        })),
    });

    const repoKey = resolveAutoShowMoreRepoKey({
      groups,
      selectedLogicalWorkspaceId: null,
      itemLimit: 6,
    });

    expect(repoKey).toBeNull();
  });

  it("does not resolve a repo key when the selected logical workspace is within the item cap", () => {
    const groups = buildGroups({
      logicalWorkspaces: Array.from({ length: 7 }, (_, index) =>
        makeLocalLogicalWorkspace({
          id: `worktree-${index}`,
          repoKey: "/tmp/repo-a",
          repoName: "repo-a",
          kind: "worktree",
          branch: `feature/worktree-${index}`,
          updatedAt: `2026-04-13T10:0${index}:00.000Z`,
        })),
      selectedLogicalWorkspaceId: "worktree-5",
    });

    const repoKey = resolveAutoShowMoreRepoKey({
      groups,
      selectedLogicalWorkspaceId: "worktree-5",
      itemLimit: 6,
    });

    expect(repoKey).toBeNull();
  });

  it("does not resolve a repo key when the group is under the item cap", () => {
    const groups = buildGroups({
      logicalWorkspaces: Array.from({ length: 5 }, (_, index) =>
        makeLocalLogicalWorkspace({
          id: `worktree-${index}`,
          repoKey: "/tmp/repo-a",
          repoName: "repo-a",
          kind: "worktree",
          branch: `feature/worktree-${index}`,
          updatedAt: `2026-04-13T10:0${index}:00.000Z`,
        })),
      selectedLogicalWorkspaceId: "worktree-4",
    });

    const repoKey = resolveAutoShowMoreRepoKey({
      groups,
      selectedLogicalWorkspaceId: "worktree-4",
      itemLimit: 6,
    });

    expect(repoKey).toBeNull();
  });

  it("carries the runtime workspace id for worktree done actions", () => {
    const groups = buildGroups({
      logicalWorkspaces: [
        makeLocalLogicalWorkspace({
          id: "path:/tmp/repo-a/worktree",
          repoKey: "/tmp/repo-a",
          repoName: "repo-a",
          kind: "worktree",
          branch: "feature/worktree",
        }),
      ],
    });

    const item = groups[0]?.items[0];
    expect(item?.id).toBe("path:/tmp/repo-a/worktree");
    expect(item?.localWorkspaceId).toBe("path:/tmp/repo-a/worktree-materialization");
  });

  it("uses runtime workspace ids and logical workspace ids for finish suggestion actions", () => {
    const logicalWorkspace = makeLocalLogicalWorkspace({
      id: "path:/tmp/repo-a/worktree",
      repoKey: "/tmp/repo-a",
      repoName: "repo-a",
      kind: "worktree",
      branch: "feature/worktree",
    });
    const materializationId = logicalWorkspace.localWorkspace?.id ?? "";
    const groups = buildGroups({
      logicalWorkspaces: [logicalWorkspace],
      finishSuggestionsByWorkspaceId: {
        [materializationId]: {
          workspaceId: materializationId,
          readinessFingerprint: "fingerprint-1",
        },
      },
    });

    const finishSuggestion = groups[0]?.items[0]?.detailIndicators.find(
      (indicator) => indicator.kind === "finish_suggestion",
    );
    expect(finishSuggestion).toEqual({
      kind: "finish_suggestion",
      workspaceId: materializationId,
      logicalWorkspaceId: "path:/tmp/repo-a/worktree",
      readinessFingerprint: "fingerprint-1",
      tooltip: "Ready to mark done",
    });
  });

  it("normalizes all selected workspace types back to the default order", () => {
    expect(resolveSidebarWorkspaceTypes(["cloud", "local", "worktree"])).toEqual(
      DEFAULT_SIDEBAR_WORKSPACE_TYPES,
    );
  });

  it("does not allow the last workspace type filter to be unchecked", () => {
    expect(toggleSidebarWorkspaceTypeSelection(["local"], "local")).toEqual(["local"]);
    expect(toggleSidebarWorkspaceTypeSelection(["local", "cloud"], "cloud")).toEqual(["local"]);
  });

  it("distinguishes true empty and filter-empty sidebar states", () => {
    expect(resolveSidebarEmptyState(0, 0)).toBe("noWorkspaces");
    expect(resolveSidebarEmptyState(2, 0)).toBe("filteredOut");
    expect(resolveSidebarEmptyState(2, 1)).toBeNull();
  });

});
