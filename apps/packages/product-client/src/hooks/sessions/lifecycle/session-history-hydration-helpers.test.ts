import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SessionEventEnvelope } from "@anyharness/sdk";
import { resolveSessionViewState } from "@proliferate/product-domain/sessions/activity";
import { replaySessionHistory } from "#product/lib/domain/sessions/stream/stream-state";
import {
  applyHistoryStateToStores,
} from "#product/hooks/sessions/lifecycle/session-history-hydration-helpers";
import {
  createEmptySessionRecord,
  getSessionRecord,
  putSessionRecord,
} from "#product/stores/sessions/session-records";
import { useSessionDirectoryStore } from "#product/stores/sessions/session-directory-store";
import { useSessionIntentStore } from "#product/stores/sessions/session-intent-store";
import { useSessionTranscriptStore } from "#product/stores/sessions/session-transcript-store";

describe("applyHistoryStateToStores", () => {
  beforeEach(() => {
    useSessionDirectoryStore.getState().clearEntries();
    useSessionIntentStore.getState().clear();
    useSessionTranscriptStore.getState().clearEntries();
  });

  afterEach(() => {
    useSessionDirectoryStore.getState().clearEntries();
    useSessionIntentStore.getState().clear();
    useSessionTranscriptStore.getState().clearEntries();
  });

  it.each([
    {
      name: "turn completion",
      envelope: turnEnded(2),
      expectedStatus: "idle" as const,
      expectedPhase: "idle" as const,
      expectedViewState: "idle" as const,
    },
    {
      name: "turn interruption",
      envelope: turnEnded(2, "turn-1", "cancelled"),
      expectedStatus: "idle" as const,
      expectedPhase: "idle" as const,
      expectedViewState: "idle" as const,
    },
    {
      name: "turn error",
      envelope: errorEvent(2),
      expectedStatus: "errored" as const,
      expectedPhase: "errored" as const,
      expectedViewState: "errored" as const,
    },
  ])("applies an authoritative $name from a history tail", ({
    envelope,
    expectedStatus,
    expectedPhase,
    expectedViewState,
  }) => {
    const currentState = replaySessionHistory("session-1", [turnStarted(1)]);
    const currentRecord = {
      ...createEmptySessionRecord("session-1", "codex", {
        workspaceId: "workspace-1",
      }),
      events: currentState.events,
      transcript: currentState.transcript,
      status: "running" as const,
      executionSummary: {
        phase: "running" as const,
        hasLiveHandle: true,
        pendingInteractions: [],
        updatedAt: "2026-04-04T00:00:01Z",
      },
      streamConnectionState: "disconnected" as const,
      transcriptHydrated: true,
    };
    putSessionRecord(currentRecord);
    const nextState = replaySessionHistory("session-1", [turnStarted(1), envelope]);

    applyHistoryStateToStores("session-1", currentRecord, {
      events: nextState.events,
      transcript: nextState.transcript,
      reconcileEnvelopes: [envelope],
    });

    const updated = getSessionRecord("session-1")!;
    expect(updated.transcript.isStreaming).toBe(false);
    expect(updated.status).toBe(expectedStatus);
    expect(updated.executionSummary?.phase).toBe(expectedPhase);
    expect(resolveSessionViewState(updated)).toBe(expectedViewState);
  });

  it("does not let prepended older history overwrite newer running activity", () => {
    const events = [turnStarted(1, "turn-1"), turnEnded(2, "turn-1"), turnStarted(3, "turn-2")];
    const currentState = replaySessionHistory("session-1", events);
    const currentRecord = {
      ...createEmptySessionRecord("session-1", "codex", {
        workspaceId: "workspace-1",
      }),
      events: currentState.events,
      transcript: currentState.transcript,
      status: "running" as const,
      executionSummary: {
        phase: "running" as const,
        hasLiveHandle: true,
        pendingInteractions: [],
        updatedAt: "2026-04-04T00:00:03Z",
      },
      streamConnectionState: "open" as const,
      transcriptHydrated: true,
    };
    putSessionRecord(currentRecord);

    applyHistoryStateToStores("session-1", currentRecord, {
      events: currentState.events,
      transcript: currentState.transcript,
      reconcileEnvelopes: [events[1]!],
    });

    const updated = getSessionRecord("session-1")!;
    expect(updated.status).toBe("running");
    expect(updated.executionSummary?.phase).toBe("running");
    expect(resolveSessionViewState(updated)).toBe("working");
  });
});

function turnStarted(seq: number, turnId = "turn-1"): SessionEventEnvelope {
  return {
    sessionId: "session-1",
    seq,
    timestamp: `2026-04-04T00:00:0${seq}Z`,
    turnId,
    event: { type: "turn_started" },
  };
}

function turnEnded(
  seq: number,
  turnId = "turn-1",
  stopReason: "end_turn" | "cancelled" = "end_turn",
): SessionEventEnvelope {
  return {
    sessionId: "session-1",
    seq,
    timestamp: `2026-04-04T00:00:0${seq}Z`,
    turnId,
    event: { type: "turn_ended", stopReason },
  };
}

function errorEvent(seq: number): SessionEventEnvelope {
  return {
    sessionId: "session-1",
    seq,
    timestamp: `2026-04-04T00:00:0${seq}Z`,
    turnId: "turn-1",
    itemId: "error-1",
    event: {
      type: "error",
      message: "failed",
    },
  };
}
