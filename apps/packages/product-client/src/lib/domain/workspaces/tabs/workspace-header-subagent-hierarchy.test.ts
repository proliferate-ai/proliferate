import { describe, expect, it } from "vitest";
import type {
  ChildSubagentSummary,
  ParentSubagentLinkSummary,
  SessionSubagentsResponse,
} from "@anyharness/sdk";
import {
  buildWorkspaceHeaderSubagentHierarchy,
  type HeaderHierarchyQueryRow,
} from "#product/lib/domain/workspaces/tabs/workspace-header-subagent-hierarchy";

describe("buildWorkspaceHeaderSubagentHierarchy", () => {
  it("carries a requested close onto the child row", () => {
    const hierarchy = buildWorkspaceHeaderSubagentHierarchy({
      rows: [row({
        children: [
          child({ childSessionId: "child-1" }),
          child({
            childSessionId: "child-2",
            closedBySessionId: "parent-1",
            closeReason: "superseded",
          }),
        ],
      })],
      resolveClientSessionId: (sessionId) => sessionId,
    });

    const children = hierarchy.childrenByParentSessionId.get("parent-1") ?? [];
    expect(children.map((entry) => entry.closeRequestedLabel)).toEqual([
      null,
      "Closing · superseded",
    ]);
  });

  it("keeps a promoted child out of its parent's fanout", () => {
    const hierarchy = buildWorkspaceHeaderSubagentHierarchy({
      rows: [row({
        children: [
          child({ childSessionId: "child-1" }),
          child({
            childSessionId: "child-2",
            promotedAt: "2026-08-08T01:00:00Z",
          }),
        ],
      })],
      resolveClientSessionId: (sessionId) => sessionId,
    });

    const children = hierarchy.childrenByParentSessionId.get("parent-1") ?? [];
    expect(children.map((entry) => entry.sessionId)).toEqual(["child-1"]);
    expect(hierarchy.childToParent.has("child-2")).toBe(false);
  });

  it("drops the parent breadcrumb once the session itself was promoted", () => {
    const promoted = buildWorkspaceHeaderSubagentHierarchy({
      rows: [row({
        children: [],
        parent: parentLink({ promotedAt: "2026-08-08T01:00:00Z" }),
      })],
      resolveClientSessionId: (sessionId) => sessionId,
    });
    expect(promoted.childToParent.has("parent-1")).toBe(false);
    expect(promoted.parentRowsBySessionId.size).toBe(0);

    const subordinate = buildWorkspaceHeaderSubagentHierarchy({
      rows: [row({ children: [], parent: parentLink({}) })],
      resolveClientSessionId: (sessionId) => sessionId,
    });
    expect(subordinate.childToParent.get("parent-1")).toBe("grandparent-1");
  });
});

function parentLink(
  overrides: Partial<ParentSubagentLinkSummary>,
): ParentSubagentLinkSummary {
  return {
    sessionLinkId: "link-parent",
    parentSessionId: "grandparent-1",
    parentAgentKind: "claude",
    linkCreatedAt: "2026-04-04T00:00:00Z",
    ...overrides,
  };
}

function row(args: {
  children: ChildSubagentSummary[];
  parent?: ParentSubagentLinkSummary;
}): HeaderHierarchyQueryRow {
  const subagentData: SessionSubagentsResponse = {
    parent: args.parent,
    children: args.children,
    ownedAgents: [],
  };
  return {
    sessionId: "parent-1",
    subagentSuccess: true,
    subagentData,
    reviewSuccess: false,
    reviewData: null,
  };
}

function child(overrides: Partial<ChildSubagentSummary>): ChildSubagentSummary {
  return {
    sessionLinkId: `link-${overrides.childSessionId ?? "1"}`,
    childSessionId: "child-1",
    status: "running",
    agentKind: "claude",
    linkCreatedAt: "2026-04-04T00:00:00Z",
    childCreatedAt: "2026-04-04T00:00:00Z",
    wakeScheduled: false,
    ...overrides,
  };
}
