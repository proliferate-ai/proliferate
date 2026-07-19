import { describe, expect, it } from "vitest";
import {
  replaceSessionIdInManualChatGroups,
  replaceSessionIdInOrderedList,
  replaceSessionIdInShellTabOrder,
} from "#product/lib/domain/workspaces/tabs/session-replacement";
import { createManualChatGroupId } from "#product/lib/domain/workspaces/tabs/manual-groups";

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

  it("keeps one deterministic group owner when the runtime id already exists", () => {
    expect(replaceSessionIdInManualChatGroups([{
      id: createManualChatGroupId("runtime-group"),
      label: "Existing runtime group",
      colorId: "blue",
      sessionIds: ["new", "runtime-peer"],
    }, {
      id: createManualChatGroupId("alias-group"),
      label: "Recovered alias group",
      colorId: "magenta",
      sessionIds: ["old", "alias-peer"],
    }], "old", "new")).toEqual([{
      id: createManualChatGroupId("runtime-group"),
      label: "Existing runtime group",
      colorId: "blue",
      sessionIds: ["runtime-peer"],
    }, {
      id: createManualChatGroupId("alias-group"),
      label: "Recovered alias group",
      colorId: "magenta",
      sessionIds: ["new", "alias-peer"],
    }]);
  });
});
