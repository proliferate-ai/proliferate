import { describe, expect, it } from "vitest";
import { createDirectoryEntry } from "#product/lib/domain/sessions/directory/directory-entry";
import {
  applyPendingRelationshipHint,
  markDirectorySessionPromoted,
  putDirectoryEntry,
  recordDirectoryRelationshipHint,
  removeDirectoryEntry,
  removeWorkspaceDirectoryEntries,
  type SessionDirectoryReducerState,
} from "#product/lib/domain/sessions/directory/directory-reducer";

function emptyState(): SessionDirectoryReducerState {
  return {
    entriesById: {},
    clientSessionIdByMaterializedSessionId: {},
    sessionIdsByWorkspaceId: {},
    relationshipHintsBySessionId: {},
    promotedRootSessionIds: new Set(),
    promotedRootWorkspaceIdBySessionId: {},
  };
}

describe("session directory reducer", () => {
  it("puts entries, applies pending hints, updates indexes, and preserves no-op identity", () => {
    const hintedState: SessionDirectoryReducerState = {
      ...emptyState(),
      relationshipHintsBySessionId: {
        "session-b": {
          kind: "linked_child",
          parentSessionId: "session-a",
          workspaceId: "workspace-a",
        },
      },
      promotedRootSessionIds: new Set(),
      promotedRootWorkspaceIdBySessionId: {},
    };
    const entry = createDirectoryEntry({
      sessionId: "session-b",
      materializedSessionId: "runtime-b",
      workspaceId: "workspace-a",
      agentKind: "proliferate",
    });

    const next = putDirectoryEntry(
      hintedState,
      applyPendingRelationshipHint(entry, hintedState.relationshipHintsBySessionId["session-b"]),
    );

    expect(next.entriesById["session-b"]?.sessionRelationship).toEqual({
      kind: "linked_child",
      parentSessionId: "session-a",
      workspaceId: "workspace-a",
    });
    expect(next.clientSessionIdByMaterializedSessionId).toEqual({
      "runtime-b": "session-b",
    });
    expect(next.sessionIdsByWorkspaceId).toEqual({
      "workspace-a": ["session-b"],
    });
    expect(next.relationshipHintsBySessionId).toEqual({});
    expect(putDirectoryEntry(next, next.entriesById["session-b"]!)).toBe(next);
  });

  it("removes workspace entries, materialized indexes, and stale workspace hints together", () => {
    const sessionA = createDirectoryEntry({
      sessionId: "session-a",
      materializedSessionId: "runtime-a",
      workspaceId: "workspace-a",
      agentKind: "proliferate",
    });
    const sessionB = createDirectoryEntry({
      sessionId: "session-b",
      materializedSessionId: "runtime-b",
      workspaceId: "workspace-b",
      agentKind: "proliferate",
    });
    const state: SessionDirectoryReducerState = {
      entriesById: {
        "session-a": sessionA,
        "session-b": sessionB,
      },
      clientSessionIdByMaterializedSessionId: {
        "runtime-a": "session-a",
        "runtime-b": "session-b",
      },
      sessionIdsByWorkspaceId: {
        "workspace-a": ["session-a"],
        "workspace-b": ["session-b"],
      },
      relationshipHintsBySessionId: {
        "missing-a": {
          kind: "linked_child",
          parentSessionId: "parent-a",
          workspaceId: "workspace-a",
        },
        "missing-b": {
          kind: "linked_child",
          parentSessionId: "parent-b",
          workspaceId: "workspace-b",
        },
      },
      promotedRootSessionIds: new Set(),
      promotedRootWorkspaceIdBySessionId: {},
    };

    const result = removeWorkspaceDirectoryEntries(state, "workspace-a");

    expect(result.removedSessionIds).toEqual(["session-a"]);
    expect(result.state.entriesById).toEqual({ "session-b": sessionB });
    expect(result.state.clientSessionIdByMaterializedSessionId).toEqual({
      "runtime-b": "session-b",
    });
    expect(result.state.sessionIdsByWorkspaceId).toEqual({
      "workspace-b": ["session-b"],
    });
    expect(result.state.relationshipHintsBySessionId).toEqual({
      "missing-b": {
        kind: "linked_child",
        parentSessionId: "parent-b",
        workspaceId: "workspace-b",
      },
    });
  });

  it("keeps promoted root authority across stale hints and a directory remount", () => {
    const child = {
      ...createDirectoryEntry({
        sessionId: "client-child",
        materializedSessionId: "durable-child",
        workspaceId: "workspace-a",
        agentKind: "proliferate",
      }),
      sessionRelationship: {
        kind: "subagent_child" as const,
        parentSessionId: "durable-parent",
        workspaceId: "workspace-a",
      },
    };
    const withChild = putDirectoryEntry(emptyState(), child);
    const promoted = markDirectorySessionPromoted(
      withChild,
      ["durable-child", "client-child"],
      "workspace-a",
    );

    expect(promoted.entriesById["client-child"]?.sessionRelationship).toEqual({ kind: "root" });
    expect([...promoted.promotedRootSessionIds]).toEqual([
      "durable-child",
      "client-child",
    ]);
    expect(promoted.promotedRootWorkspaceIdBySessionId).toEqual({
      "durable-child": "workspace-a",
      "client-child": "workspace-a",
    });

    const lateClientHint = recordDirectoryRelationshipHint(
      promoted,
      "client-child",
      child.sessionRelationship,
    );
    const lateDurableHint = recordDirectoryRelationshipHint(
      lateClientHint,
      "durable-child",
      child.sessionRelationship,
    );
    expect(lateDurableHint.entriesById["client-child"]?.sessionRelationship).toEqual({
      kind: "root",
    });
    expect(lateDurableHint.relationshipHintsBySessionId).toEqual({});

    const unmounted = removeDirectoryEntry(lateDurableHint, "client-child");
    const remounted = putDirectoryEntry(unmounted, child);
    expect(remounted.entriesById["client-child"]?.sessionRelationship).toEqual({ kind: "root" });
    expect(remounted.promotedRootSessionIds.has("durable-child")).toBe(true);
    expect(remounted.promotedRootSessionIds.has("client-child")).toBe(true);
  });

  it("clears promoted aliases owned by a workspace even before an entry mounts", () => {
    const promoted = markDirectorySessionPromoted(
      emptyState(),
      ["durable-child", "client-child"],
      "workspace-a",
    );

    const removed = removeWorkspaceDirectoryEntries(promoted, "workspace-a");

    expect(removed.removedSessionIds).toEqual([]);
    expect(removed.state.promotedRootSessionIds.size).toBe(0);
    expect(removed.state.promotedRootWorkspaceIdBySessionId).toEqual({});
  });
});
