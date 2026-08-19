import { afterEach, describe, expect, it } from "vitest";
import {
  FILE_TREE_DOCK_DEFAULT_WIDTH,
  FILE_TREE_DOCK_MIN_WIDTH,
} from "#product/lib/domain/files/file-tree-dock-state";
import {
  resetFileTreeStoreForTests,
  selectFileTreeDesiredWidth,
  selectFileTreeDurableSnapshot,
  selectFileTreeExpandedPaths,
  selectFileTreeRequestedVisibility,
  selectFileTreeStateKey,
  useFileTreeStore,
} from "#product/stores/editor/file-tree-store";

const SCOPE_A = { materializedWorkspaceId: "ws-1", treeStateKey: "repo-root-1" };
const SCOPE_B = { materializedWorkspaceId: "ws-2", treeStateKey: "repo-root-1" };

function store() {
  return useFileTreeStore.getState();
}

afterEach(() => {
  resetFileTreeStoreForTests();
});

describe("durable width", () => {
  it("normalizes, clamps the lower bound, and revises only on change", () => {
    expect(selectFileTreeDesiredWidth(store())).toBe(FILE_TREE_DOCK_DEFAULT_WIDTH);
    expect(store().durableRevision).toBe(0);

    store().setDesiredWidth(10);
    expect(selectFileTreeDesiredWidth(store())).toBe(FILE_TREE_DOCK_MIN_WIDTH);
    expect(store().durableRevision).toBe(1);

    store().setDesiredWidth(10);
    expect(store().durableRevision).toBe(1);

    store().setDesiredWidth(Number.NaN);
    expect(selectFileTreeDesiredWidth(store())).toBe(FILE_TREE_DOCK_DEFAULT_WIDTH);
    expect(store().durableRevision).toBe(2);
  });
});

describe("requested visibility", () => {
  it("writes the primary key and clears a distinct stale fallback", () => {
    store().setRequestedVisibility({ primaryKey: null, fallbackKey: "ws-1" }, true);
    expect(store().requestedVisibilityByWorkspace).toEqual({ "ws-1": true });

    store().setRequestedVisibility({ primaryKey: "logical-1", fallbackKey: "ws-1" }, true);
    expect(store().requestedVisibilityByWorkspace).toEqual({ "logical-1": true });
    expect(store().durableRevision).toBe(2);
  });

  it("resolves visibility by own-key presence so an explicit primary false wins", () => {
    store().setRequestedVisibility({ primaryKey: null, fallbackKey: "ws-1" }, true);
    store().setRequestedVisibility({ primaryKey: "logical-1", fallbackKey: null }, false);

    expect(
      selectFileTreeRequestedVisibility(store(), {
        primaryKey: "logical-1",
        fallbackKey: "ws-1",
      }),
    ).toBe(false);
    expect(
      selectFileTreeRequestedVisibility(store(), { primaryKey: "other", fallbackKey: "ws-1" }),
    ).toBe(true);
    expect(
      selectFileTreeRequestedVisibility(store(), { primaryKey: null, fallbackKey: null }),
    ).toBe(false);
    expect(
      selectFileTreeRequestedVisibility(store(), { primaryKey: "absent", fallbackKey: "absent" }),
    ).toBe(false);
  });

  it("ignores a mutation with two null keys and an unchanged write", () => {
    store().setRequestedVisibility({ primaryKey: null, fallbackKey: null }, true);
    expect(store().durableRevision).toBe(0);

    store().setRequestedVisibility({ primaryKey: "logical-1", fallbackKey: null }, true);
    store().setRequestedVisibility({ primaryKey: "logical-1", fallbackKey: null }, true);
    expect(store().durableRevision).toBe(1);
  });
});

describe("prepareRequestedVisibilityPromotion", () => {
  it("returns the transform, revises, and leaves the effective fallback in memory", () => {
    store().setRequestedVisibility({ primaryKey: null, fallbackKey: "ws-1" }, true);

    const promotion = store().prepareRequestedVisibilityPromotion({
      primaryKey: "logical-1",
      fallbackKey: "ws-1",
    });

    expect(promotion).toEqual({
      introducedRevision: 2,
      primaryKey: "logical-1",
      fallbackKey: "ws-1",
      value: true,
    });
    expect(store().requestedVisibilityByWorkspace).toEqual({ "ws-1": true });
    expect(store().durableRevision).toBe(2);
    expect(
      selectFileTreeRequestedVisibility(store(), {
        primaryKey: "logical-1",
        fallbackKey: "ws-1",
      }),
    ).toBe(true);
  });

  it("returns null without revising when the promotion condition does not hold", () => {
    expect(
      store().prepareRequestedVisibilityPromotion({ primaryKey: "a", fallbackKey: "a" }),
    ).toBeNull();
    expect(
      store().prepareRequestedVisibilityPromotion({ primaryKey: "a", fallbackKey: null }),
    ).toBeNull();
    // No explicit fallback value.
    expect(
      store().prepareRequestedVisibilityPromotion({ primaryKey: "a", fallbackKey: "ws-1" }),
    ).toBeNull();

    store().setRequestedVisibility({ primaryKey: null, fallbackKey: "ws-1" }, false);
    store().setRequestedVisibility({ primaryKey: "logical-1", fallbackKey: null }, true);
    expect(
      store().prepareRequestedVisibilityPromotion({
        primaryKey: "logical-1",
        fallbackKey: "ws-1",
      }),
    ).toBeNull();
    expect(store().durableRevision).toBe(2);
  });
});

describe("authority, hydration, and promotion commits", () => {
  it("installs an authority's revision and durable fields without touching sessions", () => {
    store().claimFileTreeStateKey("ws-1", "repo-root-1");
    store().setPathExpanded(SCOPE_A, "src", true);

    store().replaceFileTreeDockAuthorityState({
      durableRevision: 7,
      desiredWidth: 520,
      requestedVisibilityByWorkspace: { "logical-9": true },
    });

    expect(store().durableRevision).toBe(7);
    expect(selectFileTreeDesiredWidth(store())).toBe(520);
    expect(store().requestedVisibilityByWorkspace).toEqual({ "logical-9": true });
    expect(selectFileTreeExpandedPaths(store(), SCOPE_A)).toEqual(new Set(["src"]));
    expect(store().firstTreeStateKeyByMaterializedWorkspace.get("ws-1")).toBe("repo-root-1");
  });

  it("applies hydration only at the expected revision and never revises", () => {
    store().setDesiredWidth(500);

    expect(
      store().applyHydratedFileTreeDockState({
        expectedDurableRevision: 0,
        desiredWidth: 320,
        requestedVisibilityByWorkspace: {},
      }),
    ).toBe(false);
    expect(selectFileTreeDesiredWidth(store())).toBe(500);

    expect(
      store().applyHydratedFileTreeDockState({
        expectedDurableRevision: 1,
        desiredWidth: 320,
        requestedVisibilityByWorkspace: { "logical-1": true },
      }),
    ).toBe(true);
    expect(selectFileTreeDesiredWidth(store())).toBe(320);
    expect(store().requestedVisibilityByWorkspace).toEqual({ "logical-1": true });
    expect(store().durableRevision).toBe(1);
  });

  it("commits a compatible promotion chain atomically without revising", () => {
    store().setRequestedVisibility({ primaryKey: null, fallbackKey: "ws-1" }, true);
    store().setRequestedVisibility({ primaryKey: null, fallbackKey: "ws-2" }, false);
    const first = store().prepareRequestedVisibilityPromotion({
      primaryKey: "logical-1",
      fallbackKey: "ws-1",
    });
    const second = store().prepareRequestedVisibilityPromotion({
      primaryKey: "logical-2",
      fallbackKey: "ws-2",
    });
    expect(first && second).toBeTruthy();
    const revision = store().durableRevision;

    expect(
      store().commitRequestedVisibilityPromotions({
        expectedDurableRevision: revision,
        promotions: [first!, second!],
      }),
    ).toBe(true);
    expect(store().requestedVisibilityByWorkspace).toEqual({
      "logical-1": true,
      "logical-2": false,
    });
    expect(store().durableRevision).toBe(revision);
  });

  it("rejects a stale or incompatible acknowledgement and changes nothing", () => {
    store().setRequestedVisibility({ primaryKey: null, fallbackKey: "ws-1" }, true);
    const promotion = store().prepareRequestedVisibilityPromotion({
      primaryKey: "logical-1",
      fallbackKey: "ws-1",
    })!;

    expect(
      store().commitRequestedVisibilityPromotions({
        expectedDurableRevision: promotion.introducedRevision - 1,
        promotions: [promotion],
      }),
    ).toBe(false);

    // Supersede the pair with an explicit primary write at the same boolean.
    store().setRequestedVisibility({ primaryKey: "logical-1", fallbackKey: "ws-1" }, true);
    const revision = store().durableRevision;
    expect(
      store().commitRequestedVisibilityPromotions({
        expectedDurableRevision: revision,
        promotions: [promotion],
      }),
    ).toBe(false);
    expect(store().requestedVisibilityByWorkspace).toEqual({ "logical-1": true });
  });

  it("rejects a partially incompatible chain without applying its valid prefix", () => {
    store().setRequestedVisibility({ primaryKey: null, fallbackKey: "ws-1" }, true);
    store().setRequestedVisibility({ primaryKey: null, fallbackKey: "ws-2" }, true);
    const first = store().prepareRequestedVisibilityPromotion({
      primaryKey: "logical-1",
      fallbackKey: "ws-1",
    })!;
    const stale = {
      introducedRevision: first.introducedRevision,
      primaryKey: "logical-2",
      fallbackKey: "ws-2",
      value: false,
    };

    expect(
      store().commitRequestedVisibilityPromotions({
        expectedDurableRevision: store().durableRevision,
        promotions: [first, stale],
      }),
    ).toBe(false);
    expect(store().requestedVisibilityByWorkspace).toEqual({ "ws-1": true, "ws-2": true });
  });
});

describe("durable snapshot", () => {
  it("contains only version, width, and the visibility map", () => {
    store().setDesiredWidth(500);
    store().setRequestedVisibility({ primaryKey: "logical-1", fallbackKey: null }, true);
    store().claimFileTreeStateKey("ws-1", "repo-root-1");
    store().setPathExpanded(SCOPE_A, "src", true);

    expect(selectFileTreeDurableSnapshot(store())).toEqual({
      version: 1,
      width: 500,
      requestedVisibilityByWorkspace: { "logical-1": true },
    });
  });
});

describe("session expansion scopes", () => {
  it("keeps composite scopes isolated and never revises durable state", () => {
    store().setPathExpanded(SCOPE_A, "src", true);
    store().togglePathExpanded(SCOPE_B, "src");

    expect(selectFileTreeExpandedPaths(store(), SCOPE_A)).toEqual(new Set(["src"]));
    expect(selectFileTreeExpandedPaths(store(), SCOPE_B)).toEqual(new Set(["src"]));
    expect(
      selectFileTreeExpandedPaths(store(), {
        materializedWorkspaceId: "ws-1",
        treeStateKey: "other-root",
      }).size,
    ).toBe(0);
    expect(store().durableRevision).toBe(0);

    store().togglePathExpanded(SCOPE_A, "src");
    expect(selectFileTreeExpandedPaths(store(), SCOPE_A).size).toBe(0);
    expect(selectFileTreeExpandedPaths(store(), SCOPE_B)).toEqual(new Set(["src"]));
  });

  it("returns one stable empty set for an absent or incomplete scope", () => {
    const first = selectFileTreeExpandedPaths(store(), null);
    const second = selectFileTreeExpandedPaths(store(), {
      materializedWorkspaceId: "ws-1",
      treeStateKey: "",
    });
    expect(first).toBe(second);
    expect(first.size).toBe(0);
  });

  it("collapses one scope only", () => {
    store().setPathExpanded(SCOPE_A, "src", true);
    store().setPathExpanded(SCOPE_A, "src/lib", true);
    store().setPathExpanded(SCOPE_B, "src", true);

    store().collapseExpansionScope(SCOPE_A);

    expect(selectFileTreeExpandedPaths(store(), SCOPE_A).size).toBe(0);
    expect(selectFileTreeExpandedPaths(store(), SCOPE_B)).toEqual(new Set(["src"]));
  });

  it("ignores expansion writes with an incomplete scope", () => {
    store().setPathExpanded({ materializedWorkspaceId: "", treeStateKey: "k" }, "src", true);
    store().togglePathExpanded({ materializedWorkspaceId: "ws-1", treeStateKey: "" }, "src");

    expect(store().expandedPathsByMaterializedWorkspace.size).toBe(0);
  });
});

describe("first tree-state-key registry", () => {
  it("is first-write-wins per materialized workspace until disposal", () => {
    store().claimFileTreeStateKey("ws-1", "ws-1");
    store().claimFileTreeStateKey("ws-1", "repo-root-1");
    store().claimFileTreeStateKey("ws-2", "repo-root-2");

    expect(
      selectFileTreeStateKey(store(), {
        materializedWorkspaceId: "ws-1",
        candidateTreeStateKey: "repo-root-1",
      }),
    ).toBe("ws-1");
    expect(
      selectFileTreeStateKey(store(), {
        materializedWorkspaceId: "ws-2",
        candidateTreeStateKey: "later",
      }),
    ).toBe("repo-root-2");
  });

  it("falls back to the supplied candidate without writing", () => {
    expect(
      selectFileTreeStateKey(store(), {
        materializedWorkspaceId: "ws-1",
        candidateTreeStateKey: "ws-1",
      }),
    ).toBe("ws-1");
    expect(store().firstTreeStateKeyByMaterializedWorkspace.size).toBe(0);
    expect(
      selectFileTreeStateKey(store(), {
        materializedWorkspaceId: null,
        candidateTreeStateKey: "ws-1",
      }),
    ).toBeNull();
    expect(
      selectFileTreeStateKey(store(), {
        materializedWorkspaceId: "ws-1",
        candidateTreeStateKey: null,
      }),
    ).toBeNull();
  });

  it("ignores an empty claim and never revises durable state", () => {
    store().claimFileTreeStateKey("", "repo-root-1");
    store().claimFileTreeStateKey("ws-1", "");

    expect(store().firstTreeStateKeyByMaterializedWorkspace.size).toBe(0);
    expect(store().durableRevision).toBe(0);
  });
});

describe("pruneFileTreeSessionState", () => {
  it("atomically clears one workspace's registry entry and expansion scopes", () => {
    store().claimFileTreeStateKey("ws-1", "repo-root-1");
    store().claimFileTreeStateKey("ws-2", "repo-root-2");
    store().setPathExpanded(SCOPE_A, "src", true);
    store().setPathExpanded(SCOPE_B, "src", true);
    store().setDesiredWidth(500);
    store().setRequestedVisibility({ primaryKey: "logical-1", fallbackKey: null }, true);
    const revision = store().durableRevision;

    store().pruneFileTreeSessionState("ws-1");

    expect(store().firstTreeStateKeyByMaterializedWorkspace.has("ws-1")).toBe(false);
    expect(selectFileTreeExpandedPaths(store(), SCOPE_A).size).toBe(0);
    expect(store().firstTreeStateKeyByMaterializedWorkspace.get("ws-2")).toBe("repo-root-2");
    expect(selectFileTreeExpandedPaths(store(), SCOPE_B)).toEqual(new Set(["src"]));
    expect(store().durableRevision).toBe(revision);
    expect(selectFileTreeDesiredWidth(store())).toBe(500);
    expect(store().requestedVisibilityByWorkspace).toEqual({ "logical-1": true });

    // A later genuinely new materialization claims its own candidate.
    store().claimFileTreeStateKey("ws-1", "repo-root-1-b");
    expect(
      selectFileTreeStateKey(store(), {
        materializedWorkspaceId: "ws-1",
        candidateTreeStateKey: "ignored",
      }),
    ).toBe("repo-root-1-b");
  });

  it("is a no-op for an unknown materialized workspace", () => {
    store().claimFileTreeStateKey("ws-2", "repo-root-2");
    const before = store().firstTreeStateKeyByMaterializedWorkspace;

    store().pruneFileTreeSessionState("ws-unknown");

    expect(store().firstTreeStateKeyByMaterializedWorkspace).toBe(before);
  });
});

describe("resetFileTreeStoreForTests", () => {
  it("clears both session structures and durable state", () => {
    store().claimFileTreeStateKey("ws-1", "repo-root-1");
    store().setPathExpanded(SCOPE_A, "src", true);
    store().setDesiredWidth(500);

    resetFileTreeStoreForTests();

    expect(store().firstTreeStateKeyByMaterializedWorkspace.size).toBe(0);
    expect(store().expandedPathsByMaterializedWorkspace.size).toBe(0);
    expect(selectFileTreeDesiredWidth(store())).toBe(FILE_TREE_DOCK_DEFAULT_WIDTH);
    expect(store().durableRevision).toBe(0);
  });
});
