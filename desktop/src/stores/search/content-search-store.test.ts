import { afterEach, describe, expect, it } from "vitest";
import {
  selectVisibleContentSearchMatchIds,
  useContentSearchStore,
} from "./content-search-store";

function resetStore() {
  useContentSearchStore.setState({
    open: false,
    query: "",
    scope: "diffs",
    activeMatchIndex: 0,
    activeMatchId: null,
    unitsById: {},
    nextUnitOrder: 0,
  });
}

describe("content search store", () => {
  afterEach(resetStore);

  it("filters visible matches by normalized query and active scope", () => {
    resetStore();
    useContentSearchStore.getState().setQuery("  foo  ");
    useContentSearchStore.getState().registerUnit({
      unitId: "diff-a",
      scope: "diffs",
      query: "foo",
      matchIds: ["diff-a:0", "diff-a:1"],
    });
    useContentSearchStore.getState().registerUnit({
      unitId: "chat-a",
      scope: "chat",
      query: "foo",
      matchIds: ["chat-a:0"],
    });

    expect(selectVisibleContentSearchMatchIds(useContentSearchStore.getState())).toEqual([
      "diff-a:0",
      "diff-a:1",
    ]);

    useContentSearchStore.getState().setScope("chat");
    expect(selectVisibleContentSearchMatchIds(useContentSearchStore.getState())).toEqual([
      "chat-a:0",
    ]);
  });

  it("keeps active match navigation wrapped to the visible result set", () => {
    resetStore();
    useContentSearchStore.getState().setQuery("foo");
    useContentSearchStore.getState().registerUnit({
      unitId: "diff-a",
      scope: "diffs",
      query: "foo",
      matchIds: ["diff-a:0", "diff-a:1"],
    });

    expect(useContentSearchStore.getState().activeMatchId).toBe("diff-a:0");

    useContentSearchStore.getState().goToNextMatch();
    expect(useContentSearchStore.getState().activeMatchId).toBe("diff-a:1");

    useContentSearchStore.getState().goToNextMatch();
    expect(useContentSearchStore.getState().activeMatchId).toBe("diff-a:0");

    useContentSearchStore.getState().goToPreviousMatch();
    expect(useContentSearchStore.getState().activeMatchId).toBe("diff-a:1");
  });
});
