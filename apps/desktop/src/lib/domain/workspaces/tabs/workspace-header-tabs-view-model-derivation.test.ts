import { describe, expect, it } from "vitest";
import {
  buildHeaderChatTabs,
  buildHeaderClosedChatTabs,
  buildHeaderDisplayShellRows,
  hasUnreadSessionActivity,
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

  it("marks inactive tabs with unread session activity", () => {
    const tabs = buildHeaderChatTabs({
      groupedTabs: [{
        sessionId: "session-1",
        parentSessionId: null,
        groupRootSessionId: "session-1",
        isChild: false,
      }],
      rowsBySessionId: new Map(),
      childrenByParentSessionId: new Map(),
      resolvedSessionIds: new Set(["session-1"]),
      knownSessions: new Map<string, KnownHeaderSession>([[
        "session-1",
        placeholder("session-1"),
      ]]),
      manualGroupByTopLevelSessionId: new Map(),
      sessionLastInteracted: {
        "session-1": "2026-04-04T00:00:20.000Z",
      },
      sessionLastViewedAt: {
        "session-1": "2026-04-04T00:00:10.000Z",
      },
    });

    expect(tabs[0]?.hasUnreadActivity).toBe(true);
    expect(tabs[0]?.isResolvingSession).toBe(true);
  });

  it("clears unread activity on the highlighted chat tab", () => {
    const tab = {
      ...baseHeaderTab("session-1"),
      hasUnreadActivity: true,
    };

    const rows = buildHeaderDisplayShellRows({
      highlightedChatSessionId: "session-1",
      shellRows: [{
        kind: "chat",
        row: {
          kind: "tab",
          tab,
        },
        shellKeys: ["chat:session-1"],
      }],
    });

    expect(rows[0]?.kind).toBe("chat");
    if (rows[0]?.kind !== "chat" || rows[0].row.kind !== "tab") {
      throw new Error("expected chat tab row");
    }
    expect(rows[0].row.tab.isActive).toBe(true);
    expect(rows[0].row.tab.hasUnreadActivity).toBe(false);
  });
});

describe("hasUnreadSessionActivity", () => {
  it("compares session activity against the session read timestamp", () => {
    expect(hasUnreadSessionActivity({
      sessionId: "session-1",
      sessionLastInteracted: { "session-1": "2026-04-04T00:00:11.000Z" },
      sessionLastViewedAt: { "session-1": "2026-04-04T00:00:10.000Z" },
    })).toBe(true);
    expect(hasUnreadSessionActivity({
      sessionId: "session-1",
      sessionLastInteracted: { "session-1": "2026-04-04T00:00:10.000Z" },
      sessionLastViewedAt: { "session-1": "2026-04-04T00:00:10.000Z" },
    })).toBe(false);
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
      isResolvingSession: true,
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

function baseHeaderTab(sessionId: string) {
  return {
    id: sessionId,
    sessionId,
    parentSessionId: null,
    groupRootSessionId: sessionId,
    isChild: false,
    title: sessionId,
    agentKind: "claude",
    viewState: "idle" as const,
    canFork: false,
    isReviewAgentChild: false,
    source: null,
    sessionLinkId: null,
    workspaceId: "workspace",
    isActive: false,
    hasUnreadActivity: false,
    groupColor: null,
    visualGroupId: null,
    manualGroupId: null,
    isHierarchyResolved: true,
    isResolvingSession: false,
    delegatedAgent: null,
    delegatedIndicators: [],
  };
}
