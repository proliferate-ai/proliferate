import { beforeEach, describe, expect, it } from "vitest";
import type { SessionSubagentsResponse } from "@anyharness/sdk";
import { anyHarnessSessionSubagentsKey } from "@anyharness/sdk-react";
import { collectSubagentSessionRelationshipHints } from "#product/domain/chats/subagents/session-relationship-hints";
import { buildWorkspaceHeaderSubagentHierarchy } from "#product/lib/domain/workspaces/tabs/workspace-header-subagent-hierarchy";
import {
  clearStagedReplacedSessionTombstone,
  resetReplacedSessionTombstonesForTests,
  stageReplacedSessionTombstone,
} from "#product/hooks/sessions/workflows/session-replacement-tombstones";
import {
  buildHeaderSessionSubagentsQueryKey,
  filterPromotedHeaderSubagents,
  shouldEnableHeaderSessionScopedQuery,
} from "#product/hooks/workspaces/cache/tabs/use-workspace-header-subagent-hierarchy";

beforeEach(() => {
  resetReplacedSessionTombstonesForTests();
});

describe("header session-scoped query eligibility", () => {
  it("disables every query family for a tombstoned session and re-enables after rollback", () => {
    const input = {
      workspaceId: "workspace-1",
      sessionId: "runtime-old",
      materializedSessionId: "runtime-old",
      enabledByBatch: true,
    };

    expect(shouldEnableHeaderSessionScopedQuery(input)).toBe(true);

    stageReplacedSessionTombstone("workspace-1", "runtime-old");
    expect(shouldEnableHeaderSessionScopedQuery(input)).toBe(false);

    clearStagedReplacedSessionTombstone("workspace-1", "runtime-old");
    expect(shouldEnableHeaderSessionScopedQuery(input)).toBe(true);
  });
});

describe("header subagent query identity", () => {
  it("keys a mapped client session by its durable runtime id", () => {
    const key = buildHeaderSessionSubagentsQueryKey({
      cacheScopeKey: "runtime-1",
      workspaceId: "workspace-1",
      materializedSessionId: "runtime-session-1",
    });

    expect(key).toEqual(anyHarnessSessionSubagentsKey(
      "runtime-1",
      "workspace-1",
      "runtime-session-1",
    ));
    expect(key).not.toEqual(anyHarnessSessionSubagentsKey(
      "runtime-1",
      "workspace-1",
      "client-session:codex:1000:abc123",
    ));
  });
});

describe("promoted header subagent filtering", () => {
  it("removes a promoted child from both the visual hierarchy and relationship hints", () => {
    const response: SessionSubagentsResponse = {
      parent: agent("durable-parent", null),
      children: [child("durable-promoted"), child("durable-sibling")],
    };
    const resolveClientSessionId = (sessionId: string) => ({
      "durable-parent": "client-parent",
      "durable-promoted": "client-promoted",
      "durable-sibling": "client-sibling",
    })[sessionId] ?? sessionId;
    const filtered = filterPromotedHeaderSubagents({
      sessionId: "client-parent",
      response,
      promotedRootSessionIds: new Set(["client-promoted"]),
      resolveClientSessionId,
    });

    expect(filtered?.children.map((entry) => entry.agent.identity.sessionId)).toEqual([
      "durable-sibling",
    ]);
    expect(collectSubagentSessionRelationshipHints("client-parent", filtered)).toEqual([
      expect.objectContaining({ sessionId: "durable-sibling" }),
    ]);

    const hierarchy = buildWorkspaceHeaderSubagentHierarchy({
      rows: [{
        sessionId: "client-parent",
        subagentSuccess: true,
        subagentData: filtered ?? null,
        reviewSuccess: false,
        reviewData: null,
        coworkSuccess: false,
        coworkData: null,
      }],
      resolveClientSessionId,
    });
    expect(hierarchy.childToParent.has("client-promoted")).toBe(false);
    expect(hierarchy.childrenByParentSessionId.get("client-parent")?.map(
      (entry) => entry.sessionId,
    )).toEqual(["client-sibling"]);
  });

  it("detaches a promoted session from stale cached parent metadata", () => {
    const response: SessionSubagentsResponse = {
      parent: agent("durable-promoted", "durable-parent"),
      children: [],
    };
    const filtered = filterPromotedHeaderSubagents({
      sessionId: "client-promoted",
      response,
      promotedRootSessionIds: new Set(["client-promoted"]),
      resolveClientSessionId: (sessionId) => sessionId === "durable-promoted"
        ? "client-promoted"
        : sessionId,
    });

    expect(filtered?.parent.parent).toBeNull();
    expect(collectSubagentSessionRelationshipHints("client-promoted", filtered)).toEqual([]);
  });
});

function child(sessionId: string): SessionSubagentsResponse["children"][number] {
  return {
    agent: agent(sessionId, "durable-parent"),
    relationship: {
      childSessionId: sessionId,
      createdAt: "2026-08-11T00:00:00Z",
      parentSessionId: "durable-parent",
      sessionLinkId: `link-${sessionId}`,
    },
    latestCompletion: null,
  };
}

function agent(
  sessionId: string,
  parentSessionId: string | null,
): SessionSubagentsResponse["parent"] {
  return {
    identity: { runtimeId: "runtime-1", sessionId },
    workspace: { runtimeId: "runtime-1", workspaceId: "workspace-1" },
    role: parentSessionId ? "subagent" : "ordinary",
    parent: parentSessionId
      ? { runtimeId: "runtime-1", sessionId: parentSessionId }
      : null,
    title: sessionId,
    configuration: { agentKind: "codex", modelId: null, modeId: null },
    status: { presentation: "available", execution: "idle", hasLiveActor: true },
    capabilities: [],
    createdAt: "2026-08-11T00:00:00Z",
    updatedAt: "2026-08-11T00:00:00Z",
  };
}
