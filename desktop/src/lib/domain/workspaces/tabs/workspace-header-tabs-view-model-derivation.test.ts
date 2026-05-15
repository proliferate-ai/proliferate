import { describe, expect, it } from "vitest";
import {
  buildHeaderChatTabs,
  buildHeaderClosedChatTabs,
} from "./workspace-header-tabs-view-model-derivation";
import type {
  HeaderHierarchyChildRow,
  KnownHeaderSession,
} from "./workspace-header-tabs-model-helpers";

describe("workspace header tab view model derivation", () => {
  it("adds generated delegated-agent identity to child tabs", () => {
    const tabs = buildHeaderChatTabs({
      groupedTabs: [{
        sessionId: "working",
        parentSessionId: "parent",
        groupRootSessionId: "parent",
        isChild: true,
      }],
      rowsBySessionId: new Map([[
        "working",
        delegatedChildRow("working", "Working", false),
      ]]),
      childrenByParentSessionId: new Map(),
      resolvedSessionIds: new Set(["parent"]),
      knownSessions: new Map<string, KnownHeaderSession>([[
        "parent",
        placeholder("parent"),
      ]]),
      manualGroupByTopLevelSessionId: new Map(),
    });

    expect(tabs[0]?.delegatedAgent).toMatchObject({
      kind: "cowork",
      originLabel: "Cowork",
      statusCategory: "running",
    });
    expect(tabs[0]?.delegatedAgent?.identity.displayName)
      .toMatch(/\(.+ [a-z0-9]{6}\)/u);
  });

  it("carries cowork child routing metadata onto child tabs", () => {
    const tabs = buildHeaderChatTabs({
      groupedTabs: [{
        sessionId: "cowork-child",
        parentSessionId: "parent",
        groupRootSessionId: "parent",
        isChild: true,
      }],
      rowsBySessionId: new Map([[
        "cowork-child",
        {
          ...delegatedChildRow("cowork-child", "Working", false),
          sessionLinkId: "link-cowork",
          workspaceId: "managed-workspace",
          source: "cowork",
        },
      ]]),
      childrenByParentSessionId: new Map(),
      resolvedSessionIds: new Set(["cowork-child"]),
      knownSessions: new Map(),
      manualGroupByTopLevelSessionId: new Map(),
    });

    expect(tabs[0]).toMatchObject({
      id: "cowork-child",
      source: "cowork",
      sessionLinkId: "link-cowork",
      workspaceId: "managed-workspace",
      parentSessionId: "parent",
    });
  });
});

describe("buildHeaderClosedChatTabs", () => {
  it("returns hidden live sessions in recent order", () => {
    const rows = buildHeaderClosedChatTabs({
      highlightedChatSessionId: "b",
      rowsBySessionId: new Map([["child", closedChildRow("child", "a")]]),
      knownSessions: [
        placeholder("a"),
        placeholder("b"),
        placeholder("child"),
        placeholder("visible"),
      ],
      visibleChatSessionIds: ["visible"],
      recentlyHiddenIds: ["missing", "child", "b", "a", "b", "visible"],
    });

    expect(rows.map((row) => row.id)).toEqual(["child", "b", "a"]);
    expect(rows[0]).toMatchObject({
      id: "child",
      title: "Child child",
      viewState: "working",
      isVisible: false,
    });
    expect(rows[1]).toMatchObject({
      id: "b",
      isActive: true,
      isVisible: false,
    });
  });
});

function placeholder(sessionId: string): KnownHeaderSession {
  return { kind: "placeholder", sessionId };
}

function delegatedChildRow(
  sessionId: string,
  statusLabel: string,
  wakeScheduled: boolean,
): HeaderHierarchyChildRow {
  return {
    sessionLinkId: `link-${sessionId}`,
    sessionId,
    parentSessionId: "parent",
    workspaceId: "workspace",
    title: sessionId,
    agentKind: "claude",
    source: "cowork",
    meta: "Cowork",
    statusLabel,
    wakeScheduled,
    isActive: false,
  };
}

function closedChildRow(sessionId: string, parentSessionId: string): HeaderHierarchyChildRow {
  return {
    sessionLinkId: `link-${sessionId}`,
    sessionId,
    parentSessionId,
    workspaceId: "workspace",
    title: `Child ${sessionId}`,
    agentKind: "claude",
    source: "subagent",
    meta: null,
    statusLabel: "Working",
    wakeScheduled: false,
    isActive: false,
  };
}
