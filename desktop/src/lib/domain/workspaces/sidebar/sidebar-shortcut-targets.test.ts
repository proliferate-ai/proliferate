import { describe, expect, it } from "vitest";
import { SIDEBAR_REPO_GROUP_ITEM_LIMIT } from "@/lib/domain/workspaces/sidebar/sidebar";
import {
  resolveSidebarShortcutDigitTarget,
  visibleSidebarShortcutTargetIds,
} from "@/lib/domain/workspaces/sidebar/sidebar-shortcut-targets";
import {
  buildGroups,
  makeCloudLogicalWorkspace,
  makeLocalLogicalWorkspace,
} from "@/lib/domain/workspaces/sidebar/sidebar-test-fixtures";

describe("visibleSidebarShortcutTargetIds", () => {
  it("returns visible repository rows in sidebar group and item order", () => {
    const logicalWorkspaces = [
      makeLocalLogicalWorkspace({
        id: "repo-a-older-record-newer-work",
        repoKey: "/tmp/repo-a",
        repoName: "repo-a",
        kind: "worktree",
        updatedAt: "2026-04-13T11:00:00.000Z",
      }),
      makeLocalLogicalWorkspace({
        id: "repo-a-newer-record-older-work",
        repoKey: "/tmp/repo-a",
        repoName: "repo-a",
        kind: "worktree",
        updatedAt: "2026-04-13T12:00:00.000Z",
      }),
      makeLocalLogicalWorkspace({
        id: "repo-b-latest",
        repoKey: "/tmp/repo-b",
        repoName: "repo-b",
        updatedAt: "2026-04-13T09:00:00.000Z",
      }),
    ];
    const groups = buildGroups({
      logicalWorkspaces,
      workspaceLastInteracted: {
        "repo-a-older-record-newer-work": "2026-04-13T11:30:00.000Z",
        "repo-a-newer-record-older-work": "2026-04-13T10:00:00.000Z",
        "repo-b-latest": "2026-04-13T12:00:00.000Z",
      },
    });

    expect(visibleSidebarShortcutTargetIds({
      groups,
      collapsedRepoGroupKeys: new Set(),
      repoGroupsShownMore: new Set(),
      itemLimit: SIDEBAR_REPO_GROUP_ITEM_LIMIT,
    })).toEqual([
      "repo-b-latest",
      "repo-a-older-record-newer-work",
      "repo-a-newer-record-older-work",
    ]);
  });

  it("keeps selected type-filtered rows targetable when the sidebar kept them visible", () => {
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

    expect(visibleSidebarShortcutTargetIds({
      groups,
      collapsedRepoGroupKeys: new Set(),
      repoGroupsShownMore: new Set(),
      itemLimit: SIDEBAR_REPO_GROUP_ITEM_LIMIT,
    })).toEqual(["local-visible", "cloud-selected"]);
  });

  it("keeps selected archived rows targetable when the sidebar kept them visible", () => {
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
        }),
      ],
      archivedIds: ["archived-selected"],
      selectedLogicalWorkspaceId: "archived-selected",
    });

    expect(visibleSidebarShortcutTargetIds({
      groups,
      collapsedRepoGroupKeys: new Set(),
      repoGroupsShownMore: new Set(),
      itemLimit: SIDEBAR_REPO_GROUP_ITEM_LIMIT,
    })).toEqual(["local-visible", "archived-selected"]);
  });

  it("omits collapsed repository groups and truncates groups that have not shown more", () => {
    const groups = buildGroups({
      logicalWorkspaces: [
        ...Array.from({ length: 8 }, (_, index) =>
          makeLocalLogicalWorkspace({
            id: `repo-a-${index + 1}`,
            repoKey: "/tmp/repo-a",
            repoName: "repo-a",
            kind: "worktree",
            updatedAt: `2026-04-13T10:0${index}:00.000Z`,
          })),
        makeLocalLogicalWorkspace({
          id: "repo-b-hidden",
          repoKey: "/tmp/repo-b",
          repoName: "repo-b",
        }),
      ],
    });

    expect(visibleSidebarShortcutTargetIds({
      groups,
      collapsedRepoGroupKeys: new Set(["/tmp/repo-b"]),
      repoGroupsShownMore: new Set(),
      itemLimit: 6,
    })).toEqual([
      "repo-a-1",
      "repo-a-2",
      "repo-a-3",
      "repo-a-4",
      "repo-a-5",
      "repo-a-6",
    ]);

    expect(visibleSidebarShortcutTargetIds({
      groups,
      collapsedRepoGroupKeys: new Set(["/tmp/repo-b"]),
      repoGroupsShownMore: new Set(["/tmp/repo-a"]),
      itemLimit: 6,
    })).toEqual([
      "repo-a-1",
      "repo-a-2",
      "repo-a-3",
      "repo-a-4",
      "repo-a-5",
      "repo-a-6",
      "repo-a-7",
      "repo-a-8",
    ]);
  });

  it("does not change target ids when visual-only sidebar inputs change", () => {
    const logicalWorkspaces = [
      makeLocalLogicalWorkspace({
        id: "workspace-a",
        repoKey: "/tmp/repo-a",
        repoName: "repo-a",
      }),
      makeLocalLogicalWorkspace({
        id: "workspace-b",
        repoKey: "/tmp/repo-a",
        repoName: "repo-a",
        kind: "worktree",
      }),
    ];
    const baseGroups = buildGroups({ logicalWorkspaces });
    const visualGroups = buildGroups({
      logicalWorkspaces,
      workspaceActivities: {
        "workspace-a": "error",
      },
      pendingPromptCounts: {
        "workspace-a": 2,
      },
      lastViewedAt: {
        "workspace-a": "2026-04-13T10:00:00.000Z",
      },
      finishSuggestionsByWorkspaceId: {
        "workspace-a-materialization": {
          workspaceId: "workspace-a-materialization",
          readinessFingerprint: "fingerprint-1",
        },
      },
    });

    const readTargets = (groups: typeof baseGroups) => visibleSidebarShortcutTargetIds({
      groups,
      collapsedRepoGroupKeys: new Set(),
      repoGroupsShownMore: new Set(),
      itemLimit: SIDEBAR_REPO_GROUP_ITEM_LIMIT,
    });

    expect(readTargets(visualGroups)).toEqual(readTargets(baseGroups));
  });
});

describe("resolveSidebarShortcutDigitTarget", () => {
  it("resolves digits one through eight by index and digit nine as the last target", () => {
    const targetIds = ["a", "b", "c", "d"];

    expect(resolveSidebarShortcutDigitTarget(targetIds, 1)).toBe("a");
    expect(resolveSidebarShortcutDigitTarget(targetIds, 4)).toBe("d");
    expect(resolveSidebarShortcutDigitTarget(targetIds, 9)).toBe("d");
  });

  it("returns null for missing targets", () => {
    expect(resolveSidebarShortcutDigitTarget([], 9)).toBeNull();
    expect(resolveSidebarShortcutDigitTarget(["a"], 2)).toBeNull();
  });
});
