import { describe, expect, it } from "vitest";
import type { GroupedChatTab } from "./grouping";
import { buildHeaderStripRows } from "./group-rows";
import {
  createManualChatGroupId,
  type DisplayManualChatGroup,
} from "./manual-groups";

describe("buildHeaderStripRows", () => {
  it("emits standalone tabs without pill rows", () => {
    const rows = buildHeaderStripRows({
      groupedTabs: [tab("a"), tab("b")],
      childrenByParentSessionId: new Map(),
      collapsedGroupIds: [],
      resolveManualGroupColor: manualColorFor,
    });

    expect(rows.map(rowKey)).toEqual(["tab:a", "tab:b"]);
  });

  it("emits an expanded subagent group as pill, parent, then children", () => {
    const rows = buildHeaderStripRows({
      groupedTabs: [tab("p"), child("c1", "p"), child("c2", "p")],
      childrenByParentSessionId: new Map([["p", [{ sessionId: "c1" }, { sessionId: "c2" }]]]),
      collapsedGroupIds: [],
      resolveManualGroupColor: manualColorFor,
    });

    expect(rows.map(rowKey)).toEqual(["subagent:p", "tab:p", "tab:c1", "tab:c2"]);
    expect(rows[0]).toMatchObject({
      kind: "pill",
      groupKind: "subagent",
      groupId: "p",
      parentId: "p",
      color: null,
      label: "Agents",
      isCollapsed: false,
    });
  });

  it("emits only the pill for a collapsed subagent group", () => {
    const rows = buildHeaderStripRows({
      groupedTabs: [tab("p"), child("c1", "p")],
      childrenByParentSessionId: new Map([["p", [{ sessionId: "c1" }]]]),
      collapsedGroupIds: ["p"],
      resolveManualGroupColor: manualColorFor,
    });

    expect(rows.map(rowKey)).toEqual(["subagent:p"]);
    expect(rows[0]).toMatchObject({ kind: "pill", isCollapsed: true });
  });

  it("auto-expands a collapsed subagent group that contains the active session", () => {
    const rows = buildHeaderStripRows({
      groupedTabs: [tab("p"), child("c1", "p")],
      childrenByParentSessionId: new Map([["p", [{ sessionId: "c1" }]]]),
      collapsedGroupIds: ["p"],
      activeSessionId: "c1",
      resolveManualGroupColor: manualColorFor,
    });

    expect(rows.map(rowKey)).toEqual(["subagent:p", "tab:p", "tab:c1"]);
    expect(rows[0]).toMatchObject({ kind: "pill", isCollapsed: false });
  });

  it("emits manual groups at the first visible member", () => {
    const rows = buildHeaderStripRows({
      groupedTabs: [tab("a"), tab("b"), tab("c")],
      childrenByParentSessionId: new Map(),
      collapsedGroupIds: [],
      manualGroups: [manualGroup("g1", ["b", "c"])],
      resolveManualGroupColor: manualColorFor,
    });

    expect(rows.map(rowKey)).toEqual(["tab:a", "manual:manual:g1", "tab:b", "tab:c"]);
  });

  it("renders expanded manual groups with subagent children but without nested pills", () => {
    const rows = buildHeaderStripRows({
      groupedTabs: [tab("p"), child("c1", "p"), child("c2", "p"), tab("q")],
      childrenByParentSessionId: new Map([["p", [{ sessionId: "c1" }, { sessionId: "c2" }]]]),
      collapsedGroupIds: [],
      manualGroups: [manualGroup("g1", ["p", "q"])],
      resolveManualGroupColor: manualColorFor,
    });

    expect(rows.map(rowKey)).toEqual([
      "manual:manual:g1",
      "tab:p",
      "tab:c1",
      "tab:c2",
      "tab:q",
    ]);
  });

  it("collapses manual groups and auto-expands when active", () => {
    const collapsedRows = buildHeaderStripRows({
      groupedTabs: [tab("a"), tab("b")],
      childrenByParentSessionId: new Map(),
      collapsedGroupIds: [createManualChatGroupId("g1")],
      manualGroups: [manualGroup("g1", ["a", "b"])],
      resolveManualGroupColor: manualColorFor,
    });
    const activeRows = buildHeaderStripRows({
      groupedTabs: [tab("a"), tab("b")],
      childrenByParentSessionId: new Map(),
      collapsedGroupIds: [createManualChatGroupId("g1")],
      manualGroups: [manualGroup("g1", ["a", "b"])],
      activeSessionId: "b",
      resolveManualGroupColor: manualColorFor,
    });

    expect(collapsedRows.map(rowKey)).toEqual(["manual:manual:g1"]);
    expect(activeRows.map(rowKey)).toEqual(["manual:manual:g1", "tab:a", "tab:b"]);
  });

  it("normalizes a visible child before its parent into parent-first group rows", () => {
    const rows = buildHeaderStripRows({
      groupedTabs: [child("c1", "p"), tab("p"), child("c2", "p")],
      childrenByParentSessionId: new Map([["p", [{ sessionId: "c1" }, { sessionId: "c2" }]]]),
      collapsedGroupIds: [],
      resolveManualGroupColor: manualColorFor,
    });

    expect(rows.map(rowKey)).toEqual(["subagent:p", "tab:p", "tab:c1", "tab:c2"]);
  });
});

function tab(sessionId: string): GroupedChatTab {
  return {
    sessionId,
    parentSessionId: null,
    groupRootSessionId: sessionId,
    isChild: false,
  };
}

function child(sessionId: string, parentSessionId: string): GroupedChatTab {
  return {
    sessionId,
    parentSessionId,
    groupRootSessionId: parentSessionId,
    isChild: true,
  };
}

function manualGroup(id: string, sessionIds: string[]): DisplayManualChatGroup {
  return {
    id: createManualChatGroupId(id),
    label: "Group",
    colorId: "blue",
    sessionIds,
  };
}

function manualColorFor(group: DisplayManualChatGroup): string {
  return `manual-color-${group.id}`;
}

function rowKey(row: ReturnType<typeof buildHeaderStripRows>[number]): string {
  if (row.kind === "pill") {
    return `${row.groupKind}:${row.groupId}`;
  }
  return `tab:${row.tab.sessionId}`;
}
