import { describe, expect, it } from "vitest";
import {
  preservesVisibleChatSession,
  resolveChatSessionIdsToHide,
} from "#product/lib/domain/workspaces/tabs/visibility";

describe("visible chat session invariant", () => {
  it("blocks hiding the only visible session", () => {
    expect(preservesVisibleChatSession({
      visibleSessionIds: ["session-1"],
      sessionIdsToHide: ["session-1"],
      childToParent: new Map(),
    })).toBe(false);
  });

  it("allows closing one session when a deterministic survivor remains", () => {
    expect(preservesVisibleChatSession({
      visibleSessionIds: ["session-1", "session-2"],
      sessionIdsToHide: ["session-1"],
      childToParent: new Map(),
    })).toBe(true);
  });

  it("includes linked children when closing a parent", () => {
    const childToParent = new Map([["child-1", "parent-1"]]);

    expect(resolveChatSessionIdsToHide({
      sessionIds: ["parent-1"],
      childToParent,
    })).toEqual(["parent-1", "child-1"]);
    expect(preservesVisibleChatSession({
      visibleSessionIds: ["parent-1", "child-1"],
      sessionIdsToHide: ["parent-1"],
      childToParent,
    })).toBe(false);
  });

  it("fails closed for a bulk action that contains every visible session", () => {
    expect(preservesVisibleChatSession({
      visibleSessionIds: ["session-1", "session-2"],
      sessionIdsToHide: ["session-1", "session-2"],
      childToParent: new Map(),
    })).toBe(false);
  });
});
