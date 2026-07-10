import { describe, expect, it } from "vitest";
import type { Session } from "@anyharness/sdk";
import {
  buildHeaderLiveVisibilityCandidates,
  buildKnownHeaderSessions,
  getKnownSessionCanFork,
  getKnownSessionId,
  getKnownSessionViewState,
  resolveHierarchyMaterializedSessionId,
} from "@/lib/domain/workspaces/tabs/workspace-header-tabs-model-helpers";
import type { SessionDirectoryEntry } from "@/lib/domain/sessions/directory/directory-entry";

function idleSlot(canFork: boolean): SessionDirectoryEntry {
  return {
    sessionId: "slot-session",
    workspaceId: "workspace-1",
    materializedSessionId: null,
    title: null,
    agentKind: "codex",
    status: "idle",
    actionCapabilities: { fork: canFork, targetedFork: false },
    executionSummary: {
      phase: "idle",
      hasLiveHandle: true,
      pendingInteractions: [],
      updatedAt: "2026-05-01T00:00:00Z",
    },
    streamConnectionState: "open",
    activity: {
      isStreaming: false,
      pendingInteractions: [],
      transcriptTitle: null,
      errorAttentionKey: null,
    },
  } as unknown as SessionDirectoryEntry;
}

function session(canFork: boolean, overrides: Partial<Session> = {}): Session {
  return {
    id: "session-1",
    workspaceId: "workspace-1",
    agentKind: "codex",
    status: "idle",
    dismissedAt: null,
    actionCapabilities: { fork: canFork, targetedFork: false },
    ...overrides,
  } as Session;
}

describe("getKnownSessionCanFork", () => {
  it("uses persisted session capabilities when the live slot is stale", () => {
    expect(getKnownSessionCanFork({
      kind: "slot",
      slot: idleSlot(false),
      session: session(true),
    })).toBe(true);
  });
});

describe("getKnownSessionId", () => {
  it("uses the client session id for materialized query rows mapped back to projections", () => {
    expect(getKnownSessionId({
      kind: "session",
      session: session(false, { id: "server-session-1" }),
      clientSessionId: "client-session:codex:1000:abc123",
    })).toBe("client-session:codex:1000:abc123");
  });
});

describe("buildKnownHeaderSessions", () => {
  it("filters remote rows and preserves the persisted session under a live slot", () => {
    const persistedSession = session(true, {
      id: "server-session-1",
      title: "Persisted title",
      workspaceId: "workspace-1",
    });
    const liveSlot = {
      ...idleSlot(false),
      sessionId: "client-session:codex:1000:abc123",
      materializedSessionId: "server-session-1",
      title: "Live title",
    } as SessionDirectoryEntry;

    const knownSessions = buildKnownHeaderSessions({
      sessions: [
        persistedSession,
        session(false, {
          id: "dismissed-session",
          dismissedAt: "2026-05-01T00:00:00Z",
          workspaceId: "workspace-1",
        }),
        session(false, {
          id: "other-workspace-session",
          workspaceId: "workspace-2",
        }),
      ],
      selectedWorkspaceId: "workspace-1",
      clientSessionIdByMaterializedSessionId: {
        "server-session-1": "client-session:codex:1000:abc123",
      },
      liveSlots: [liveSlot],
    });

    expect([...knownSessions.keys()]).toEqual(["client-session:codex:1000:abc123"]);
    const known = knownSessions.get("client-session:codex:1000:abc123");
    expect(known?.kind).toBe("slot");
    expect(known?.kind === "slot" ? known.session : null).toBe(persistedSession);
  });

  it("keeps live slots visible while remote session data is missing", () => {
    const liveSlot = {
      ...idleSlot(false),
      sessionId: "live-session",
    } as SessionDirectoryEntry;

    const knownSessions = buildKnownHeaderSessions({
      sessions: undefined,
      selectedWorkspaceId: "workspace-1",
      clientSessionIdByMaterializedSessionId: {},
      liveSlots: [liveSlot],
    });

    expect(getKnownSessionId(knownSessions.get("live-session")!)).toBe("live-session");
  });

  it("creates placeholders for remembered tabs before remote session data loads", () => {
    const knownSessions = buildKnownHeaderSessions({
      optimisticSessionIds: ["remembered-session"],
      sessions: undefined,
      selectedWorkspaceId: "workspace-1",
      clientSessionIdByMaterializedSessionId: {},
      liveSlots: [],
    });

    const known = knownSessions.get("remembered-session");
    expect(known).toEqual({
      kind: "placeholder",
      sessionId: "remembered-session",
    });
    expect(getKnownSessionId(known!)).toBe("remembered-session");
    expect(getKnownSessionViewState(known!)).toBe("idle");
    expect(getKnownSessionCanFork(known!)).toBe(false);
  });
});

describe("buildHeaderLiveVisibilityCandidates", () => {
  it("adds top-level sessions and lets hierarchy candidates define child anchors", () => {
    expect(buildHeaderLiveVisibilityCandidates({
      knownSessionIds: ["parent", "child"],
      childToParent: new Map([["child", "parent"]]),
      hierarchyVisibilityCandidates: [
        { sessionId: "linked-child", parentSessionId: "parent" },
        { sessionId: "child", parentSessionId: "resolved-parent" },
      ],
    })).toEqual([
      { sessionId: "parent", parentSessionId: null },
      { sessionId: "child", parentSessionId: "resolved-parent" },
      { sessionId: "linked-child", parentSessionId: "parent" },
    ]);
  });
});

describe("getKnownSessionViewState", () => {
  it("does not show materialization-only starting state as tab activity", () => {
    expect(getKnownSessionViewState({
      kind: "slot",
      slot: {
        ...idleSlot(false),
        materializedSessionId: null,
        status: "starting",
        executionSummary: {
          phase: "starting",
          hasLiveHandle: false,
          pendingInteractions: [],
          updatedAt: "2026-05-01T00:00:00Z",
        },
        streamConnectionState: "connecting",
      },
    })).toBe("idle");
  });

  it("still shows real transcript streaming as tab activity", () => {
    expect(getKnownSessionViewState({
      kind: "slot",
      slot: {
        ...idleSlot(false),
        materializedSessionId: "session-1",
        status: "running",
        executionSummary: {
          phase: "running",
          hasLiveHandle: true,
          pendingInteractions: [],
          updatedAt: "2026-05-01T00:00:00Z",
        },
        streamConnectionState: "open",
        activity: {
          isStreaming: true,
          endsInFinalAssistantProse: false,
          pendingInteractions: [],
          transcriptTitle: null,
          errorAttentionKey: null,
        },
      },
    })).toBe("working");
  });
});

describe("resolveHierarchyMaterializedSessionId", () => {
  it("uses server-listed session ids when no live directory entry is mounted", () => {
    expect(resolveHierarchyMaterializedSessionId({
      sessionId: "server-session-1",
      materializedSessionId: null,
    })).toBe("server-session-1");
  });

  it("keeps projected client sessions disabled until materialized", () => {
    expect(resolveHierarchyMaterializedSessionId({
      sessionId: "client-session:codex:1000:abc123",
      materializedSessionId: null,
    })).toBeNull();
    expect(resolveHierarchyMaterializedSessionId({
      sessionId: "client-session:codex:1000:abc123",
      materializedSessionId: "server-session-1",
    })).toBe("server-session-1");
  });
});
