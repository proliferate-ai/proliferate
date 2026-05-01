import { describe, expect, it } from "vitest";
import { createTranscriptState, type TranscriptState } from "@anyharness/sdk";
import type { LogicalWorkspace } from "@/lib/domain/workspaces/logical-workspaces";
import {
  hotReopenWorkspaceLookupIds,
  isHotReopenEligibleSessionSlot,
  resolveHotReopenCandidate,
  type HotReopenSessionSlotSnapshot,
} from "@/lib/domain/workspaces/hot-reopen";

describe("hotReopenWorkspaceLookupIds", () => {
  it("uses the resolved workspace id, logical id, related materializations, and de-dupes", () => {
    expect(hotReopenWorkspaceLookupIds("workspace-local", logicalWorkspace())).toEqual([
      "workspace-local",
      "logical:repo",
      "cloud:cloud-1",
    ]);
  });
});

describe("isHotReopenEligibleSessionSlot", () => {
  it("accepts hydrated slots for the resolved materialized workspace", () => {
    expect(isHotReopenEligibleSessionSlot(
      slot({ sessionId: "session-1", workspaceId: "workspace-1", hydrated: true }),
      "workspace-1",
      () => false,
    )).toBe(true);
  });

  it("accepts clearly empty fresh slots", () => {
    expect(isHotReopenEligibleSessionSlot(
      slot({ sessionId: "session-1", workspaceId: "workspace-1", hydrated: false }),
      "workspace-1",
      () => false,
    )).toBe(true);
  });

  it("rejects pending sessions and mismatched workspaces", () => {
    expect(isHotReopenEligibleSessionSlot(
      slot({ sessionId: "pending:1", workspaceId: "workspace-1", hydrated: true }),
      "workspace-1",
      (sessionId) => sessionId.startsWith("pending:"),
    )).toBe(false);
    expect(isHotReopenEligibleSessionSlot(
      slot({ sessionId: "session-1", workspaceId: "other", hydrated: true }),
      "workspace-1",
      () => false,
    )).toBe(false);
  });

  it("rejects stale non-empty slots that have not hydrated", () => {
    const transcript = createTranscriptState("session-1");
    transcript.turnOrder = ["turn-1"];

    expect(isHotReopenEligibleSessionSlot(
      slot({
        sessionId: "session-1",
        workspaceId: "workspace-1",
        hydrated: false,
        transcript,
      }),
      "workspace-1",
      () => false,
    )).toBe(false);
  });
});

describe("resolveHotReopenCandidate", () => {
  it("prefers explicit initial active session over remembered sessions", () => {
    const candidate = resolveHotReopenCandidate({
      resolvedWorkspaceId: "workspace-1",
      logicalWorkspace: logicalWorkspace(),
      initialActiveSessionId: "session-initial",
      lastViewedSessionByWorkspace: {
        "workspace-1": "session-last",
      },
      sessionSlots: {
        "session-initial": slot({
          sessionId: "session-initial",
          workspaceId: "workspace-1",
          hydrated: true,
        }),
        "session-last": slot({
          sessionId: "session-last",
          workspaceId: "workspace-1",
          hydrated: true,
        }),
      },
      isPendingSessionId: () => false,
    });

    expect(candidate).toEqual({
      sessionId: "session-initial",
      workspaceId: "workspace-1",
      source: "initial_active",
    });
  });

  it("uses last viewed sessions across related workspace ids before arbitrary cached slots", () => {
    const candidate = resolveHotReopenCandidate({
      resolvedWorkspaceId: "workspace-1",
      logicalWorkspace: logicalWorkspace(),
      initialActiveSessionId: null,
      lastViewedSessionByWorkspace: {
        "logical:repo": "session-logical",
      },
      sessionSlots: {
        "session-fallback": slot({
          sessionId: "session-fallback",
          workspaceId: "workspace-1",
          hydrated: true,
        }),
        "session-logical": slot({
          sessionId: "session-logical",
          workspaceId: "workspace-1",
          hydrated: true,
        }),
      },
      isPendingSessionId: () => false,
    });

    expect(candidate).toEqual({
      sessionId: "session-logical",
      workspaceId: "workspace-1",
      source: "last_viewed",
    });
  });

  it("falls back to any eligible cached slot", () => {
    const candidate = resolveHotReopenCandidate({
      resolvedWorkspaceId: "workspace-1",
      logicalWorkspace: logicalWorkspace(),
      initialActiveSessionId: null,
      lastViewedSessionByWorkspace: {},
      sessionSlots: {
        "session-cached": slot({
          sessionId: "session-cached",
          workspaceId: "workspace-1",
          hydrated: true,
        }),
      },
      isPendingSessionId: () => false,
    });

    expect(candidate?.source).toBe("cached_slot");
    expect(candidate?.sessionId).toBe("session-cached");
  });
});

function logicalWorkspace(): LogicalWorkspace {
  return {
    id: "logical:repo",
    localWorkspace: { id: "workspace-local" },
    cloudWorkspace: { id: "cloud-1" },
    mobilityWorkspace: null,
    preferredMaterializationId: "workspace-local",
  } as LogicalWorkspace;
}

function slot(input: {
  sessionId: string;
  workspaceId: string | null;
  hydrated: boolean;
  transcript?: TranscriptState;
}): HotReopenSessionSlotSnapshot {
  return {
    sessionId: input.sessionId,
    workspaceId: input.workspaceId,
    transcriptHydrated: input.hydrated,
    events: [],
    transcript: input.transcript ?? createTranscriptState(input.sessionId),
    optimisticPrompt: null,
  };
}
