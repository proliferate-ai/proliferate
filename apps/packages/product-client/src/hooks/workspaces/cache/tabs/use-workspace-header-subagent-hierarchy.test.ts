import { beforeEach, describe, expect, it } from "vitest";
import type { SessionSubagentsResponse } from "@anyharness/sdk";
import { anyHarnessSessionSubagentsKey } from "@anyharness/sdk-react";
import { collectSubagentSessionRelationshipHints } from "#product/domain/chats/subagents/session-relationship-hints";
import {
  buildWorkspaceHeaderSubagentHierarchy,
  type HeaderHierarchyQueryRow,
} from "#product/lib/domain/workspaces/tabs/workspace-header-subagent-hierarchy";
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

describe("pane-only subagent filtering", () => {
  it("keeps unpromoted children out of tabs while retaining relationship hints", () => {
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
    expect(hierarchy.childrenByParentSessionId.has("client-parent")).toBe(false);
    expect(hierarchy.paneOnlySubagentSessionIds).toEqual(new Set(["client-sibling"]));
  });

  it("preserves review and Cowork children as attached tab hierarchy", () => {
    const hierarchy = buildWorkspaceHeaderSubagentHierarchy({
      rows: [{
        sessionId: "parent",
        subagentSuccess: true,
        subagentData: {
          parent: agent("parent", null),
          children: [child("subagent")],
        },
        reviewSuccess: true,
        reviewData: {
          reviews: [{
            id: "review-1",
            kind: "code",
            parentSessionId: "parent",
            rounds: [{
              id: "round-1",
              status: "reviewing",
              assignments: [{
                id: "assignment-1",
                sessionLinkId: "review-link",
                reviewerSessionId: "review-child",
                personaLabel: "Security reviewer",
                agentKind: "codex",
                status: "reviewing",
              }],
            }],
          }],
        } as HeaderHierarchyQueryRow["reviewData"],
        coworkSuccess: true,
        coworkData: {
          workspaces: [{
            coworkWorkspaceId: "cowork-workspace",
            ownershipId: "ownership-1",
            workspaceId: "workspace-2",
            sourceWorkspaceId: "workspace-1",
            label: "Cowork workspace",
            createdAt: "2026-08-12T00:00:00Z",
            sessions: [{
              coworkAgentId: "cowork-agent",
              sessionLinkId: "cowork-link",
              codingSessionId: "cowork-child",
              title: "Cowork child",
              label: "Cowork child",
              status: "running",
              agentKind: "claude",
              modelId: null,
              modeId: null,
              wakeScheduled: false,
              linkCreatedAt: "2026-08-12T00:00:00Z",
              sessionCreatedAt: "2026-08-12T00:00:00Z",
            }],
          }],
        },
      }],
      resolveClientSessionId: (sessionId) => sessionId,
    });

    expect(hierarchy.paneOnlySubagentSessionIds).toEqual(new Set(["subagent"]));
    expect(hierarchy.childToParent).toEqual(new Map([
      ["review-child", "parent"],
      ["cowork-child", "parent"],
    ]));
    expect(hierarchy.childrenByParentSessionId.get("parent")?.map((row) => row.source))
      .toEqual(["review", "cowork"]);
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
