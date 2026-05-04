import { describe, expect, it } from "vitest";
import type { SessionSubagentsResponse } from "@anyharness/sdk";
import { collectSubagentSessionRelationshipHints } from "@/lib/domain/chat/subagents/session-relationship-hints";

describe("collectSubagentSessionRelationshipHints", () => {
  it("records the queried session as a child when parent metadata exists", () => {
    const hints = collectSubagentSessionRelationshipHints("child-session", {
      parent: {
        parentSessionId: "parent-session",
        parentAgentKind: "codex",
        parentModelId: null,
        parentTitle: "Parent",
        label: null,
        linkCreatedAt: "2026-04-04T00:00:00Z",
        sessionLinkId: "parent-link",
      },
      children: [],
    });

    expect(hints).toEqual([{
      sessionId: "child-session",
      parentSessionId: "parent-session",
      sessionLinkId: "parent-link",
    }]);
  });

  it("records each returned child under the queried parent session", () => {
    const hints = collectSubagentSessionRelationshipHints("parent-session", {
      parent: null,
      children: [
        child("child-a", "link-a"),
        child("child-b", "link-b"),
      ],
    });

    expect(hints).toEqual([
      {
        sessionId: "child-a",
        parentSessionId: "parent-session",
        sessionLinkId: "link-a",
      },
      {
        sessionId: "child-b",
        parentSessionId: "parent-session",
        sessionLinkId: "link-b",
      },
    ]);
  });
});

function child(childSessionId: string, sessionLinkId: string): SessionSubagentsResponse["children"][number] {
  return {
    childSessionId,
    sessionLinkId,
    agentKind: "codex",
    childCreatedAt: "2026-04-04T00:00:00Z",
    modelId: null,
    title: childSessionId,
    label: null,
    status: "idle",
    wakeScheduled: false,
    latestCompletion: null,
    linkCreatedAt: "2026-04-04T00:00:00Z",
  };
}
