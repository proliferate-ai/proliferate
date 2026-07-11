import { describe, expect, it } from "vitest";
import {
  replaceSessionIdInManualChatGroups,
  replaceSessionIdInOrderedList,
  replaceSessionIdInShellTabOrder,
} from "./session-replacement";
import { createManualChatGroupId } from "@/lib/domain/workspaces/tabs/manual-groups";

describe("session replacement tab identity", () => {
  it("keeps the replacement in the old chat's exact order position", () => {
    expect(replaceSessionIdInShellTabOrder(
      ["chat:first", "file:src/App.tsx", "chat:old", "chat:last"],
      "old",
      "new",
    )).toEqual(["chat:first", "file:src/App.tsx", "chat:new", "chat:last"]);
  });

  it("deduplicates an already projected replacement without moving it", () => {
    expect(replaceSessionIdInOrderedList(
      ["first", "old", "new", "last"],
      "old",
      "new",
    )).toEqual(["first", "new", "last"]);
  });

  it("keeps the replacement in the old chat's manual group", () => {
    expect(replaceSessionIdInManualChatGroups([{
      id: createManualChatGroupId("group-1"),
      label: "Pair",
      colorId: "blue",
      sessionIds: ["old", "other"],
    }], "old", "new")).toEqual([{
      id: createManualChatGroupId("group-1"),
      label: "Pair",
      colorId: "blue",
      sessionIds: ["new", "other"],
    }]);
  });
});
