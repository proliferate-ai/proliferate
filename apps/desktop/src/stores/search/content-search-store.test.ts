import { afterEach, describe, expect, it } from "vitest";
import {
  selectVisibleContentSearchMatchIds,
  useContentSearchStore,
} from "./content-search-store";

function resetStore() {
  useContentSearchStore.setState({
    open: false,
    query: "",
    surface: "chat",
    activeMatchIndex: 0,
    activeMatchId: null,
    unitsById: {},
    nextUnitOrder: 0,
  });
}

describe("content search store", () => {
  afterEach(resetStore);

  it("filters visible matches by normalized query and active surface", () => {
    resetStore();
    useContentSearchStore.getState().setQuery("  foo  ");
    useContentSearchStore.getState().registerUnit({
      unitId: "chat-diff",
      surface: "chat",
      query: "foo",
      matchIds: ["chat-diff:0", "chat-diff:1"],
    });
    useContentSearchStore.getState().registerUnit({
      unitId: "file-source",
      surface: "file",
      query: "foo",
      matchIds: ["file-source:0"],
    });

    expect(selectVisibleContentSearchMatchIds(useContentSearchStore.getState())).toEqual([
      "chat-diff:0",
      "chat-diff:1",
    ]);

    useContentSearchStore.getState().openSearch("file");
    expect(useContentSearchStore.getState().surface).toBe("file");
    expect(selectVisibleContentSearchMatchIds(useContentSearchStore.getState())).toEqual([
      "file-source:0",
    ]);
  });

  it("orders keyed units by orderKey ascending and unkeyed units last", () => {
    resetStore();
    useContentSearchStore.getState().setQuery("foo");
    // Register out of visual order to prove sorting is by orderKey, not
    // registration order.
    useContentSearchStore.getState().registerUnit({
      unitId: "unkeyed-diff",
      surface: "chat",
      query: "foo",
      matchIds: ["unkeyed-diff:0"],
    });
    useContentSearchStore.getState().registerUnit({
      unitId: "row-2",
      surface: "chat",
      query: "foo",
      matchIds: ["row-2:0"],
      orderKey: 4,
    });
    useContentSearchStore.getState().registerUnit({
      unitId: "row-0",
      surface: "chat",
      query: "foo",
      matchIds: ["row-0:0"],
      orderKey: 0,
    });
    useContentSearchStore.getState().registerUnit({
      unitId: "row-0-diff",
      surface: "chat",
      query: "foo",
      matchIds: ["row-0-diff:0"],
      orderKey: 1,
    });

    expect(selectVisibleContentSearchMatchIds(useContentSearchStore.getState())).toEqual([
      "row-0:0",
      "row-0-diff:0",
      "row-2:0",
      "unkeyed-diff:0",
    ]);
  });

  it("keeps active match navigation wrapped to the visible result set", () => {
    resetStore();
    useContentSearchStore.getState().setQuery("foo");
    useContentSearchStore.getState().registerUnit({
      unitId: "chat-a",
      surface: "chat",
      query: "foo",
      matchIds: ["chat-a:0", "chat-a:1"],
      orderKey: 0,
    });

    expect(useContentSearchStore.getState().activeMatchId).toBe("chat-a:0");

    useContentSearchStore.getState().goToNextMatch();
    expect(useContentSearchStore.getState().activeMatchId).toBe("chat-a:1");

    useContentSearchStore.getState().goToNextMatch();
    expect(useContentSearchStore.getState().activeMatchId).toBe("chat-a:0");

    useContentSearchStore.getState().goToPreviousMatch();
    expect(useContentSearchStore.getState().activeMatchId).toBe("chat-a:1");
  });

  it("keeps chat and file search surfaces isolated", () => {
    resetStore();
    useContentSearchStore.getState().setQuery("foo");
    useContentSearchStore.getState().registerUnit({
      unitId: "chat-row",
      surface: "chat",
      query: "foo",
      matchIds: ["chat-row:0"],
      orderKey: 0,
    });
    useContentSearchStore.getState().registerUnit({
      unitId: "file-source",
      surface: "file",
      query: "foo",
      matchIds: ["file-source:0"],
    });

    expect(selectVisibleContentSearchMatchIds(useContentSearchStore.getState())).toEqual([
      "chat-row:0",
    ]);

    useContentSearchStore.getState().openSearch("file");
    expect(useContentSearchStore.getState().surface).toBe("file");
    expect(selectVisibleContentSearchMatchIds(useContentSearchStore.getState())).toEqual([
      "file-source:0",
    ]);
  });
});
