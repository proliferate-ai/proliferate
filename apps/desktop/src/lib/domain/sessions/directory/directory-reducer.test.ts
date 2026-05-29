import { describe, expect, it } from "vitest";
import { createDirectoryEntry } from "@/lib/domain/sessions/directory/directory-entry";
import {
  applyPendingRelationshipHint,
  putDirectoryEntry,
  removeWorkspaceDirectoryEntries,
  type SessionDirectoryReducerState,
} from "@/lib/domain/sessions/directory/directory-reducer";

function emptyState(): SessionDirectoryReducerState {
  return {
    entriesById: {},
    clientSessionIdByMaterializedSessionId: {},
    sessionIdsByWorkspaceId: {},
    relationshipHintsBySessionId: {},
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
});
