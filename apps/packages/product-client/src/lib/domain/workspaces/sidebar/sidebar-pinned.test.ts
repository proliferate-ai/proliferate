import { describe, expect, it } from "vitest";
import { collectPinnedSidebarItems } from "#product/lib/domain/workspaces/sidebar/sidebar-pinned";
import {
  sidebarGroupRowItems,
  visibleSidebarGroupItems,
} from "#product/lib/domain/workspaces/sidebar/sidebar-visible-items";
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
      expect(item.pinnedIds).toEqual(pinnedIds.includes(item.id) ? [item.id] : []);
    }

    const pinnedItems = collectPinnedSidebarItems(groups, pinnedIds);
    expect(pinnedItems.map((item) => item.id)).toEqual(["ws-c", "ws-a"]);
  });

  it("matches pins recorded under the local materialization id and keeps them unpinnable", () => {
    const pinnedIds = ["ws-b-materialization"];
    const groups = buildGroups({
      logicalWorkspaces: makeWorkspaces(),
      pinnedIds,
    });

    const pinnedItems = collectPinnedSidebarItems(groups, pinnedIds);
    expect(pinnedItems.map((item) => item.id)).toEqual(["ws-b"]);
    // The row exposes the stored pin id it matched, so unpinning removes the
    // pin even though it was recorded under a different identity.
    expect(pinnedItems[0]?.pinnedIds).toEqual(["ws-b-materialization"]);
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

  it("moves pinned rows out of the repo group body instead of duplicating them", () => {
    const groups = buildGroups({
      logicalWorkspaces: makeWorkspaces(),
      pinnedIds: ["ws-a"],
    });

    const repoOne = groups.find((group) =>
      group.items.some((item) => item.id === "ws-b"));
    // The group keeps its full visible inventory for lookups...
    expect(repoOne?.items.map((item) => item.id)).toContain("ws-a");
    // ...but the rendered rows exclude the pinned workspace.
    expect(sidebarGroupRowItems(repoOne!).map((item) => item.id)).toEqual(["ws-b"]);
    expect(
      visibleSidebarGroupItems({ group: repoOne!, isShownMore: false, itemLimit: 6 })
        .map((item) => item.id),
    ).toEqual(["ws-b"]);
  });
});
