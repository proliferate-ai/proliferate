import type { RepoRoot, Workspace } from "@anyharness/sdk";
import { describe, expect, it } from "vitest";
import type { LogicalWorkspace } from "@/lib/domain/workspaces/logical-workspaces";
import type { CloudWorkspaceSummary } from "@/lib/integrations/cloud/client";
import {
  buildSidebarGroupStates,
  DEFAULT_SIDEBAR_WORKSPACE_TYPES,
  getEffectiveExpandedSidebarGroupKeys,
  resolveSidebarEmptyState,
  resolveSidebarWorkspaceTypes,
  toggleSidebarWorkspaceTypeSelection,
  type SidebarWorkspaceVariant,
} from "./sidebar";

const DEFAULT_UPDATED_AT = "2026-04-13T10:00:00.000Z";

function makeWorkspace(args: {
  id: string;
  repoName?: string;
  sourceRoot?: string;
  kind?: Workspace["kind"];
  branch?: string;
  displayName?: string | null;
  updatedAt?: string;
}): Workspace {
  const {
    id,
    repoName = "proliferate",
    sourceRoot = `/tmp/${repoName}`,
    kind = "local",
    branch = kind === "worktree" ? `feature/${id}` : "main",
    displayName = null,
    updatedAt = DEFAULT_UPDATED_AT,
  } = args;

  return {
    id,
    kind,
    repoRootId: `${repoName}-root`,
    path: `${sourceRoot}/${id}`,
    surface: "standard",
    sourceRepoRootPath: sourceRoot,
    sourceWorkspaceId: `${repoName}-root-workspace`,
    gitProvider: "github",
    gitOwner: "proliferate-ai",
    gitRepoName: repoName,
    originalBranch: "main",
    currentBranch: branch,
    displayName,
    executionSummary: null,
    createdAt: updatedAt,
    updatedAt,
  };
}

function makeRepoRoot(args: {
  id?: string;
  repoName?: string;
  sourceRoot?: string;
  updatedAt?: string;
} = {}): RepoRoot {
  const {
    id = "repo-root-1",
    repoName = "proliferate",
    sourceRoot = `/tmp/${repoName}`,
    updatedAt = DEFAULT_UPDATED_AT,
  } = args;

  return {
    id,
    kind: "external",
    path: sourceRoot,
    displayName: repoName,
    defaultBranch: "main",
    remoteProvider: "github",
    remoteOwner: "proliferate-ai",
    remoteRepoName: repoName,
    remoteUrl: null,
    createdAt: updatedAt,
    updatedAt,
  };
}

function makeCloudWorkspace(args: {
  id: string;
  repoName?: string;
  branch?: string;
  displayName?: string | null;
  updatedAt?: string;
}): CloudWorkspaceSummary {
  const {
    id,
    repoName = "proliferate",
    branch = "main",
    displayName = null,
    updatedAt = DEFAULT_UPDATED_AT,
  } = args;

  return {
    id,
    displayName,
    repo: {
      provider: "github",
      owner: "proliferate-ai",
      name: repoName,
      branch,
      baseBranch: "main",
    },
    status: "ready",
    statusDetail: null,
    lastError: null,
    templateVersion: null,
    runtimeGeneration: 0,
    actionBlockKind: null,
    createdAt: updatedAt,
    updatedAt,
    postReadyPhase: "idle",
    postReadyFilesTotal: 0,
    postReadyFilesApplied: 0,
    postReadyStartedAt: null,
    postReadyCompletedAt: null,
  };
}

function makeLocalLogicalWorkspace(args: {
  id: string;
  repoKey: string;
  repoName: string;
  kind?: Workspace["kind"];
  branch?: string;
  updatedAt?: string;
}): LogicalWorkspace {
  const {
    id,
    repoKey,
    repoName,
    kind = "local",
    branch,
    updatedAt = DEFAULT_UPDATED_AT,
  } = args;
  const localWorkspace = makeWorkspace({
    id: `${id}-materialization`,
    repoName,
    sourceRoot: repoKey,
    kind,
    branch,
    updatedAt,
  });

  return {
    id,
    repoKey,
    sourceRoot: repoKey,
    repoRoot: null,
    provider: "github",
    owner: "proliferate-ai",
    repoName,
    branchKey: branch ?? localWorkspace.currentBranch ?? "main",
    displayName: localWorkspace.displayName ?? localWorkspace.gitRepoName ?? repoName,
    localWorkspace,
    cloudWorkspace: null,
    mobilityWorkspace: null,
    preferredMaterializationId: localWorkspace.id,
    effectiveOwner: "local",
    lifecycle: "local_active",
    updatedAt,
  };
}

function makeCloudLogicalWorkspace(args: {
  id: string;
  repoKey: string;
  repoName: string;
  branch?: string;
  updatedAt?: string;
}): LogicalWorkspace {
  const {
    id,
    repoKey,
    repoName,
    branch = "main",
    updatedAt = DEFAULT_UPDATED_AT,
  } = args;
  const cloudWorkspace = makeCloudWorkspace({
    id: `${id}-cloud`,
    repoName,
    branch,
    updatedAt,
  });

  return {
    id,
    repoKey,
    sourceRoot: repoKey,
    repoRoot: null,
    provider: "github",
    owner: "proliferate-ai",
    repoName,
    branchKey: branch,
    displayName: cloudWorkspace.displayName ?? repoName,
    localWorkspace: null,
    cloudWorkspace,
    mobilityWorkspace: null,
    preferredMaterializationId: `cloud:${cloudWorkspace.id}`,
    effectiveOwner: "cloud",
    lifecycle: "cloud_active",
    updatedAt,
  };
}

function buildGroups(args: {
  logicalWorkspaces: LogicalWorkspace[];
  repoRoots?: RepoRoot[];
  workspaceTypes?: SidebarWorkspaceVariant[];
  showArchived?: boolean;
  archivedIds?: string[];
  hiddenRepoRootIds?: string[];
  selectedLogicalWorkspaceId?: string | null;
}) {
  return buildSidebarGroupStates({
    repoRoots: args.repoRoots ?? [],
    logicalWorkspaces: args.logicalWorkspaces,
    showArchived: args.showArchived ?? false,
    workspaceTypes: args.workspaceTypes ?? DEFAULT_SIDEBAR_WORKSPACE_TYPES,
    archivedSet: new Set(args.archivedIds ?? []),
    hiddenRepoRootIds: new Set(args.hiddenRepoRootIds ?? []),
    selectedLogicalWorkspaceId: args.selectedLogicalWorkspaceId ?? null,
    selectedWorkspaceId: null,
    workspaceActivities: {},
    gitStatus: undefined,
    activeSessionTitle: null,
    lastViewedAt: {},
    workspaceLastInteracted: {},
  });
}

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

  it("force-expands a repo group when the selected logical workspace is past the item cap", () => {
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

    const expandedKeys = getEffectiveExpandedSidebarGroupKeys({
      groups,
      explicitlyExpandedRepoKeys: new Set(),
      selectedLogicalWorkspaceId: "worktree-6",
      itemLimit: 6,
    });

    expect(Array.from(expandedKeys)).toEqual(["/tmp/repo-a"]);
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
