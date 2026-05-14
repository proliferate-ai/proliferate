import { describe, expect, it } from "vitest";
import { buildHeaderClosedChatTabs } from "./workspace-header-tabs-view-model-derivation";
import type {
  HeaderHierarchyChildRow,
  KnownHeaderSession,
} from "./workspace-header-tabs-model-helpers";

function placeholder(sessionId: string): KnownHeaderSession {
  return { kind: "placeholder", sessionId };
}

function childRow(sessionId: string, parentSessionId: string): HeaderHierarchyChildRow {
  return {
    sessionLinkId: `link-${sessionId}`,
    sessionId,
    parentSessionId,
    title: `Child ${sessionId}`,
    agentKind: "claude",
    source: "subagent",
    meta: null,
    statusLabel: "Working",
    wakeScheduled: false,
    isActive: false,
  };
}

describe("buildHeaderClosedChatTabs", () => {
  it("returns hidden live sessions in recent order", () => {
    const rows = buildHeaderClosedChatTabs({
      highlightedChatSessionId: "b",
      rowsBySessionId: new Map([["child", childRow("child", "a")]]),
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
