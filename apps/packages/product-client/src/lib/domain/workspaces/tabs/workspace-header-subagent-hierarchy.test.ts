import { describe, expect, it } from "vitest";
import type { ChildSubagentSummary, SessionSubagentsResponse } from "@anyharness/sdk";
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
});

function row(args: { children: ChildSubagentSummary[] }): HeaderHierarchyQueryRow {
  const subagentData: SessionSubagentsResponse = {
    children: args.children,
    ownedAgents: [],
  };
  return {
    sessionId: "parent-1",
    subagentSuccess: true,
    subagentData,
    reviewSuccess: false,
    reviewData: null,
    coworkSuccess: false,
    coworkData: null,
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
