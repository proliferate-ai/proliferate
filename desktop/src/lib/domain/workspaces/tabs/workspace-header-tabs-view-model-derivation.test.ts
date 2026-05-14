import { describe, expect, it } from "vitest";
import {
  buildHeaderChatTabs,
} from "@/lib/domain/workspaces/tabs/workspace-header-tabs-view-model-derivation";
import type {
  HeaderHierarchyChildRow,
  KnownHeaderSession,
} from "@/lib/domain/workspaces/tabs/workspace-header-tabs-model-helpers";

describe("workspace header tab view model derivation", () => {
  it("sorts delegated indicators by attention priority", () => {
    const tabs = buildHeaderChatTabs({
      groupedTabs: [{
        sessionId: "parent",
        parentSessionId: null,
        groupRootSessionId: "parent",
        isChild: false,
      }],
      rowsBySessionId: new Map(),
      childrenByParentSessionId: new Map([[
        "parent",
        [
          childRow("done", "Done", false),
          childRow("failed", "Failed", false),
          childRow("working", "Working", false),
          childRow("wake", "Idle", true),
        ],
      ]]),
      resolvedSessionIds: new Set(["parent"]),
      knownSessions: new Map<string, KnownHeaderSession>([[
        "parent",
        { kind: "placeholder", sessionId: "parent" },
      ]]),
      manualGroupByTopLevelSessionId: new Map(),
    });

    expect(tabs[0]?.delegatedIndicators.map((indicator) => indicator.sessionId))
      .toEqual(["failed", "working", "wake", "done"]);
  });
});

function childRow(
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
