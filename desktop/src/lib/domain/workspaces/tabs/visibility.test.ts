import { describe, expect, it } from "vitest";
import {
  MAX_RECENTLY_HIDDEN_CHAT_TABS,
  rememberHiddenChatSessionId,
  resolveFallbackAfterHidingChatTabs,
  resolveMostRecentHiddenChatTab,
  resolveVisibleChatSessionIds,
} from "./visibility";

describe("chat tab visibility", () => {
  it("defaults to top-level live sessions and adds a parent anchor for an active child", () => {
    const result = resolveVisibleChatSessionIds({
      liveSessions: [
        { sessionId: "parent" },
        { sessionId: "child", parentSessionId: "parent" },
        { sessionId: "other" },
      ],
      activeSessionId: "child",
    });

    expect(result.visibleSessionIds).toEqual(["parent", "other", "child"]);
  });

  it("keeps persisted hidden top-level sessions hidden while appending new top-level sessions", () => {
    const result = resolveVisibleChatSessionIds({
      liveSessions: [
        { sessionId: "a" },
        { sessionId: "b" },
        { sessionId: "c" },
      ],
      persistedVisibleIds: ["a"],
      recentlyHiddenIds: ["b"],
    });

    expect(result.visibleSessionIds).toEqual(["a", "c"]);
  });

  it("prunes stale visible and hidden ids without reviving missing sessions", () => {
    const result = resolveVisibleChatSessionIds({
      liveSessions: [{ sessionId: "live" }],
      persistedVisibleIds: ["missing", "live"],
      recentlyHiddenIds: ["gone", "live"],
    });

    expect(result.prunedPersistedVisibleIds).toEqual(["live"]);
    expect(result.prunedRecentlyHiddenIds).toEqual(["live"]);
  });

  it("chooses the nearest visible fallback after hiding the active tab", () => {
    expect(resolveFallbackAfterHidingChatTabs({
      visibleIdsBeforeHide: ["a", "b", "c"],
      idsToHide: ["b"],
      activeSessionId: "b",
    })).toBe("c");

    expect(resolveFallbackAfterHidingChatTabs({
      visibleIdsBeforeHide: ["a", "b", "c"],
      idsToHide: ["c"],
      activeSessionId: "c",
    })).toBe("b");
  });

  it("tracks recently hidden sessions most-recent-first with a cap", () => {
    const ids = Array.from({ length: MAX_RECENTLY_HIDDEN_CHAT_TABS + 5 }, (_, index) => `s${index}`);
    const result = ids.reduce((current, id) => rememberHiddenChatSessionId(current, id), [] as string[]);

    expect(result).toHaveLength(MAX_RECENTLY_HIDDEN_CHAT_TABS);
    expect(result[0]).toBe("s54");
    expect(rememberHiddenChatSessionId(result, "s50")[0]).toBe("s50");
  });

  it("restores the most recent hidden live tab that is not already visible", () => {
    expect(resolveMostRecentHiddenChatTab({
      recentlyHiddenIds: ["missing", "visible", "target"],
      liveIds: ["visible", "target"],
      visibleIds: ["visible"],
    })).toBe("target");
  });
});
