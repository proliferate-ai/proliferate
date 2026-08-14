import { describe, expect, it } from "vitest";
import type { SessionSubagentsResponse } from "@anyharness/sdk";
import { collectSubagentSessionRelationshipHints } from "./session-relationship-hints";

describe("collectSubagentSessionRelationshipHints", () => {
  it("records the queried session as a child when parent metadata exists", () => {
    const hints = collectSubagentSessionRelationshipHints("child-session", {
      parent: agent("child-session", {
        runtimeId: "runtime-1",
        sessionId: "parent-session",
      }),
      children: [],
    });

    expect(hints).toEqual([{
      sessionId: "child-session",
      parentSessionId: "parent-session",
      sessionLinkId: null,
    }]);
  });

  it("records each returned child under the queried parent session", () => {
    const hints = collectSubagentSessionRelationshipHints("parent-session", {
      parent: agent("parent-session", null),
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
    agent: agent(childSessionId, {
      runtimeId: "runtime-1",
      sessionId: "parent-session",
    }),
    relationship: {
      childSessionId,
      createdAt: "2026-04-04T00:00:00Z",
      parentSessionId: "parent-session",
      sessionLinkId,
    },
    latestCompletion: null,
  };
}

function agent(
  sessionId: string,
  parent: { runtimeId: string; sessionId: string } | null,
): SessionSubagentsResponse["parent"] {
  return {
    identity: { runtimeId: "runtime-1", sessionId },
    workspace: { runtimeId: "runtime-1", workspaceId: "workspace-1" },
    role: parent ? "subagent" : "ordinary",
    parent,
    title: sessionId,
    configuration: { agentKind: "codex", modelId: null, modeId: null },
    status: { presentation: "available", execution: "idle", hasLiveActor: true },
    capabilities: [],
    createdAt: "2026-04-04T00:00:00Z",
    updatedAt: "2026-04-04T00:00:00Z",
  };
}
