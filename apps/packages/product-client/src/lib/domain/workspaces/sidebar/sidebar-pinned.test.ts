import { describe, expect, it } from "vitest";
import { collectPinnedSidebarItems } from "#product/lib/domain/workspaces/sidebar/sidebar-pinned";
import {
  buildGroups,
  makeLocalLogicalWorkspace,
} from "#product/lib/domain/workspaces/sidebar/sidebar-test-fixtures";

function makeWorkspaces() {
  return [
    makeLocalLogicalWorkspace({ id: "ws-a", repoKey: "repo-1", repoName: "repo-one" }),
    makeLocalLogicalWorkspace({ id: "ws-b", repoKey: "repo-1", repoName: "repo-one", kind: "worktree" }),
    makeLocalLogicalWorkspace({ id: "ws-c", repoKey: "repo-2", repoName: "repo-two" }),
  ];
}

describe("collectPinnedSidebarItems", () => {
  it("marks pinned items and collects them across repo groups in pin order", () => {
    const pinnedIds = ["ws-c", "ws-a"];
    const groups = buildGroups({
      logicalWorkspaces: makeWorkspaces(),
      pinnedIds,
    });

    for (const item of groups.flatMap((group) => group.items)) {
      expect(item.pinned).toBe(pinnedIds.includes(item.id));
    }

    const pinnedItems = collectPinnedSidebarItems(groups, pinnedIds);
    expect(pinnedItems.map((item) => item.id)).toEqual(["ws-c", "ws-a"]);
  });

  it("matches pins recorded under the local materialization id", () => {
    const pinnedIds = ["ws-b-materialization"];
    const groups = buildGroups({
      logicalWorkspaces: makeWorkspaces(),
      pinnedIds,
    });

    const pinnedItems = collectPinnedSidebarItems(groups, pinnedIds);
    expect(pinnedItems.map((item) => item.id)).toEqual(["ws-b"]);
  });

  it("keeps archived workspaces out of the pinned items", () => {
    const pinnedIds = ["ws-a", "ws-c"];
    const groups = buildGroups({
      logicalWorkspaces: makeWorkspaces(),
      pinnedIds,
      archivedIds: ["ws-a"],
    });

    const pinnedItems = collectPinnedSidebarItems(groups, pinnedIds);
    expect(pinnedItems.map((item) => item.id)).toEqual(["ws-c"]);
  });

  it("returns no items when nothing is pinned", () => {
    const groups = buildGroups({ logicalWorkspaces: makeWorkspaces() });

    expect(collectPinnedSidebarItems(groups, [])).toEqual([]);
  });
});
