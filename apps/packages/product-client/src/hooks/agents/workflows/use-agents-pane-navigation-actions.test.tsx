// @vitest-environment jsdom

import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useAgentsPaneNavigationActions } from "#product/hooks/agents/workflows/use-agents-pane-navigation-actions";
import type { SessionChildRelationship } from "#product/lib/domain/sessions/directory/relationship";
import { useAgentsPaneNavigationStore } from "#product/stores/agents/agents-pane-navigation-store";
import { useSessionDirectoryStore } from "#product/stores/sessions/session-directory-store";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";

const SOURCE_WORKSPACE_ID = "workspace-source";
const OWNER_WORKSPACE_ID = "workspace-owner";
const PARENT_ID = "durable-parent";
const CLIENT_CHILD_ID = "client-child";
const DURABLE_CHILD_ID = "durable-child";

beforeEach(() => {
  useAgentsPaneNavigationStore.setState({ routesByWorkspaceId: {} });
  useSessionDirectoryStore.getState().clearEntries();
  useSessionSelectionStore.getState().clearSelection();
});

afterEach(() => {
  cleanup();
  useAgentsPaneNavigationStore.setState({ routesByWorkspaceId: {} });
  useSessionDirectoryStore.getState().clearEntries();
  useSessionSelectionStore.getState().clearSelection();
});

describe("useAgentsPaneNavigationActions classification", () => {
  it("keeps absent and pending historical targets unresolved without roster authority", () => {
    const { result } = renderHook(() => useAgentsPaneNavigationActions());
    expect(result.current.classifyAgentsPaneTarget({
      workspaceId: SOURCE_WORKSPACE_ID,
      parentSessionId: PARENT_ID,
      childSessionId: DURABLE_CHILD_ID,
    })).toBe("unresolved");

    useSessionDirectoryStore.getState().upsertEntry({
      sessionId: CLIENT_CHILD_ID,
      materializedSessionId: DURABLE_CHILD_ID,
      workspaceId: OWNER_WORKSPACE_ID,
      agentKind: "claude",
      sessionRelationship: { kind: "pending" },
    });
    expect(result.current.classifyAgentsPaneTarget({
      workspaceId: SOURCE_WORKSPACE_ID,
      parentSessionId: PARENT_ID,
      childSessionId: DURABLE_CHILD_ID,
    })).toBe("unresolved");
    expect(result.current.classifyAgentsPaneTarget({
      workspaceId: SOURCE_WORKSPACE_ID,
      parentSessionId: PARENT_ID,
      childSessionId: DURABLE_CHILD_ID,
      authoritativeCurrentRosterSubagent: true,
    })).toBe("subagent");
    expect(result.current.classifyAgentsPaneTarget({
      workspaceId: OWNER_WORKSPACE_ID,
      parentSessionId: PARENT_ID,
      childSessionId: DURABLE_CHILD_ID,
      historicalSubagentProvenance: true,
    })).toBe("subagent");
    expect(result.current.classifyAgentsPaneTarget({
      workspaceId: SOURCE_WORKSPACE_ID,
      parentSessionId: PARENT_ID,
      childSessionId: DURABLE_CHILD_ID,
      historicalSubagentProvenance: true,
    })).toBe("unresolved");
  });

  it("lets authoritative roster provenance correct a generic root without treating it as promotion", () => {
    useSessionDirectoryStore.getState().upsertEntry({
      sessionId: CLIENT_CHILD_ID,
      materializedSessionId: DURABLE_CHILD_ID,
      workspaceId: OWNER_WORKSPACE_ID,
      agentKind: "claude",
      sessionRelationship: { kind: "root" },
    });
    const { result } = renderHook(() => useAgentsPaneNavigationActions());

    expect(result.current.resolveAgentsPaneTarget({
      workspaceId: SOURCE_WORKSPACE_ID,
      parentSessionId: PARENT_ID,
      childSessionId: DURABLE_CHILD_ID,
      authoritativeCurrentRosterSubagent: true,
    })).toEqual({
      classification: "subagent",
      clientSessionId: CLIENT_CHILD_ID,
      relationship: { kind: "root" },
      workspaceId: OWNER_WORKSPACE_ID,
    });
    expect(result.current.classifyAgentsPaneTarget({
      workspaceId: SOURCE_WORKSPACE_ID,
      parentSessionId: PARENT_ID,
      childSessionId: DURABLE_CHILD_ID,
    })).toBe("other_relationship");
  });

  it("keeps explicit promotion authoritative across stale aliases and remount", () => {
    const staleSubagentRelationship: SessionChildRelationship = {
      kind: "subagent_child",
      parentSessionId: PARENT_ID,
      sessionLinkId: "link-child",
      relation: "subagent",
      workspaceId: OWNER_WORKSPACE_ID,
    };
    const directory = useSessionDirectoryStore.getState();
    directory.upsertEntry({
      sessionId: CLIENT_CHILD_ID,
      materializedSessionId: DURABLE_CHILD_ID,
      workspaceId: OWNER_WORKSPACE_ID,
      agentKind: "claude",
      sessionRelationship: staleSubagentRelationship,
    });
    directory.markSessionPromoted(
      [DURABLE_CHILD_ID, CLIENT_CHILD_ID],
      OWNER_WORKSPACE_ID,
    );
    directory.recordRelationshipHint(CLIENT_CHILD_ID, staleSubagentRelationship);
    directory.recordRelationshipHint(DURABLE_CHILD_ID, staleSubagentRelationship);
    directory.removeEntry(CLIENT_CHILD_ID);
    directory.recordRelationshipHint(CLIENT_CHILD_ID, staleSubagentRelationship);
    directory.recordRelationshipHint(DURABLE_CHILD_ID, staleSubagentRelationship);
    directory.upsertEntry({
      sessionId: CLIENT_CHILD_ID,
      materializedSessionId: DURABLE_CHILD_ID,
      workspaceId: OWNER_WORKSPACE_ID,
      agentKind: "claude",
      sessionRelationship: staleSubagentRelationship,
    });

    const current = useSessionDirectoryStore.getState();
    expect(current.entriesById[CLIENT_CHILD_ID]?.sessionRelationship).toEqual({ kind: "root" });
    expect(current.relationshipHintsBySessionId).toEqual({});
    expect(current.promotedRootSessionIds.has(CLIENT_CHILD_ID)).toBe(true);
    expect(current.promotedRootSessionIds.has(DURABLE_CHILD_ID)).toBe(true);

    const { result } = renderHook(() => useAgentsPaneNavigationActions());
    expect(result.current.resolveAgentsPaneTarget({
      workspaceId: SOURCE_WORKSPACE_ID,
      parentSessionId: PARENT_ID,
      childSessionId: DURABLE_CHILD_ID,
      authoritativeCurrentRosterSubagent: true,
    })).toEqual({
      classification: "promoted",
      clientSessionId: CLIENT_CHILD_ID,
      relationship: { kind: "root" },
      workspaceId: OWNER_WORKSPACE_ID,
    });
  });

  it.each([
    ["cowork_child" as const, true],
    ["cowork_child" as const, false],
    ["review_child" as const, true],
    ["review_child" as const, false],
  ])("routes %s provenance as another relationship when mounted=%s", (kind, mounted) => {
    const relationship: SessionChildRelationship = {
      kind,
      parentSessionId: PARENT_ID,
      relation: kind === "cowork_child" ? "cowork" : "review",
      workspaceId: OWNER_WORKSPACE_ID,
    };
    if (mounted) {
      useSessionDirectoryStore.getState().upsertEntry({
        sessionId: CLIENT_CHILD_ID,
        materializedSessionId: DURABLE_CHILD_ID,
        workspaceId: OWNER_WORKSPACE_ID,
        agentKind: "claude",
        sessionRelationship: relationship,
      });
    } else {
      useSessionDirectoryStore.getState().recordRelationshipHint(
        DURABLE_CHILD_ID,
        relationship,
      );
    }
    const { result } = renderHook(() => useAgentsPaneNavigationActions());

    expect(result.current.resolveAgentsPaneTarget({
      workspaceId: SOURCE_WORKSPACE_ID,
      parentSessionId: PARENT_ID,
      childSessionId: DURABLE_CHILD_ID,
      authoritativeCurrentRosterSubagent: true,
    })).toMatchObject({
      classification: "other_relationship",
      relationship,
      workspaceId: OWNER_WORKSPACE_ID,
    });
  });
});
