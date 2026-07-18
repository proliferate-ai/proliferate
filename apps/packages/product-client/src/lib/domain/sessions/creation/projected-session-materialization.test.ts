import { describe, expect, it } from "vitest";
import {
  isProjectedSessionMaterializationCandidate,
} from "#product/lib/domain/sessions/creation/projected-session-materialization";
import {
  createDirectoryEntry,
} from "#product/lib/domain/sessions/directory/directory-entry";
import type {
  SessionRelationship,
} from "#product/lib/domain/sessions/directory/relationship";

describe("isProjectedSessionMaterializationCandidate", () => {
  it.each<SessionRelationship>([
    { kind: "root" },
    { kind: "pending" },
  ])("accepts an unmaterialized $kind session", (sessionRelationship) => {
    expect(isProjectedSessionMaterializationCandidate(session({
      materializedSessionId: null,
      sessionRelationship,
    }))).toBe(true);
  });

  it("rejects a materialized root session", () => {
    expect(isProjectedSessionMaterializationCandidate(session({
      materializedSessionId: "runtime-session-1",
      sessionRelationship: { kind: "root" },
    }))).toBe(false);
  });

  it.each<SessionRelationship>([
    { kind: "subagent_child", parentSessionId: "parent-1" },
    { kind: "cowork_child", parentSessionId: "parent-1" },
    { kind: "review_child", parentSessionId: "parent-1" },
    { kind: "linked_child", parentSessionId: "parent-1" },
  ])("leaves an unmaterialized $kind session to its parent flow", (sessionRelationship) => {
    expect(isProjectedSessionMaterializationCandidate(session({
      materializedSessionId: null,
      sessionRelationship,
    }))).toBe(false);
  });
});

function session(input: {
  materializedSessionId: string | null;
  sessionRelationship: SessionRelationship;
}) {
  return createDirectoryEntry({
    sessionId: "client-session-1",
    workspaceId: "workspace-1",
    agentKind: "claude",
    ...input,
  });
}
