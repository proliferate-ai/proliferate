import { describe, expect, it } from "vitest";
import type { Session } from "@anyharness/sdk";
import { resolveHierarchyMaterializedSessionId } from "@/hooks/workspaces/tabs/use-workspace-header-subagent-hierarchy";
import {
  getKnownSessionCanFork,
  getKnownSessionId,
  getKnownSessionViewState,
} from "@/hooks/workspaces/tabs/workspace-header-tabs-model-helpers";
import type { SessionDirectoryEntry } from "@/stores/sessions/session-types";

function idleSlot(canFork: boolean): SessionDirectoryEntry {
  return {
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

function session(canFork: boolean): Session {
  return {
    status: "idle",
    dismissedAt: null,
    actionCapabilities: { fork: canFork, targetedFork: false },
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
      session: {
        id: "server-session-1",
      } as Session,
      clientSessionId: "client-session:codex:1000:abc123",
    })).toBe("client-session:codex:1000:abc123");
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
