import { describe, expect, it, vi } from "vitest";
import {
  createManualChatGroupId,
  deriveManualChatGroupsForDisplay,
  getRandomManualChatGroupColorId,
  normalizeManualChatGroupsForMutation,
  removeSessionsFromManualChatGroups,
  resolveManualChatGroupColor,
  sanitizeManualChatGroups,
  sanitizeManualChatGroupsByWorkspace,
  updateManualChatGroup,
  upsertManualChatGroup,
  type ManualChatGroup,
} from "@/lib/domain/workspaces/tabs/manual-groups";

describe("manual chat groups", () => {
  it("sanitizes malformed persisted groups and stores stable color ids", () => {
    expect(sanitizeManualChatGroups([
      group("g1", ["a", "a", "b"], { colorId: "magenta" }),
      group("g2", ["a"], { colorId: "green" as unknown as ManualChatGroup["colorId"] }),
      { id: "bad", label: "Bad", colorId: "blue", sessionIds: ["a", "b"] },
    ])).toEqual([
      group("g1", ["a", "b"], { colorId: "magenta" }),
    ]);

    expect(sanitizeManualChatGroupsByWorkspace({
      w1: [group("g1", ["a", "b"])],
      w2: [{ id: "bad", label: "Bad", colorId: "blue", sessionIds: ["a", "b"] }],
    })).toEqual({
      w1: [group("g1", ["a", "b"])],
    });
  });

  it("derives display groups without mutating persisted membership during partial hydration", () => {
    const groups = [group("g1", ["a", "b", "c"])];

    expect(deriveManualChatGroupsForDisplay({
      groups,
      visibleSessionIds: ["a", "b", "c"],
      childToParent: new Map([["c", "parent"]]),
      resolvedHierarchySessionIds: new Set(["a", "b", "c"]),
    })).toEqual([group("g1", ["a", "b", "c"], { sessionIds: ["a", "b"] })]);

    expect(groups[0].sessionIds).toEqual(["a", "b", "c"]);
  });

  it("hides under-populated display groups during partial hierarchy hydration", () => {
    expect(deriveManualChatGroupsForDisplay({
      groups: [group("g1", ["a", "b"])],
      visibleSessionIds: ["a", "b"],
      childToParent: new Map(),
      resolvedHierarchySessionIds: new Set(["a"]),
    })).toEqual([]);
  });

  it("normalizes explicit mutation paths against loaded top-level sessions", () => {
    expect(normalizeManualChatGroupsForMutation({
      groups: [
        group("g1", ["a", "b", "child"]),
        group("g2", ["b", "c", "missing"]),
      ],
      liveSessionIds: ["a", "b", "c", "child"],
      childToParent: new Map([["child", "a"]]),
      resolvedHierarchySessionIds: new Set(["a", "b", "c", "child"]),
    })).toEqual([
      group("g1", ["a", "b"], { sessionIds: ["a", "b"] }),
    ]);
  });

  it("upserts groups by moving sessions out of previous manual groups", () => {
    expect(upsertManualChatGroup([
      group("old", ["a", "b", "c"]),
      group("keep", ["d", "e"]),
    ], group("new", ["b", "c"]))).toEqual([
      group("keep", ["d", "e"]),
      group("new", ["b", "c"]),
    ]);
  });

  it("updates, removes, and resolves colors", () => {
    expect(updateManualChatGroup([
      group("g1", ["a", "b"]),
    ], createManualChatGroupId("g1"), {
      label: "Renamed",
      colorId: "yellow",
    })).toEqual([
      group("g1", ["a", "b"], { label: "Renamed", colorId: "yellow" }),
    ]);

    expect(removeSessionsFromManualChatGroups([
      group("g1", ["a", "b", "c"]),
    ], ["b"])).toEqual([
      group("g1", ["a", "c"]),
    ]);

    expect(removeSessionsFromManualChatGroups([
      group("g1", ["a", "b"]),
    ], ["b"])).toEqual([]);
    expect(resolveManualChatGroupColor("blue")).toContain("color-terminal-blue");
  });

  it("chooses a stable color id from the palette", () => {
    const random = vi.spyOn(Math, "random").mockReturnValue(0.99);
    expect(getRandomManualChatGroupColorId()).toBe("yellow");
    random.mockRestore();
  });
});

function group(
  id: string,
  sessionIds: string[],
  overrides: Partial<ManualChatGroup> = {},
): ManualChatGroup {
  return {
    id: createManualChatGroupId(id),
    label: "Group",
    colorId: "blue",
    sessionIds,
    ...overrides,
  };
}
