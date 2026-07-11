import type {
  SessionEventEnvelope,
  SessionLiveConfigSnapshot,
} from "@anyharness/sdk";
import { createTranscriptState } from "@anyharness/sdk";
import { describe, expect, it } from "vitest";
import {
  createResolveInteractionIntent,
  createSendPromptIntent,
  createUpdateConfigIntent,
} from "./session-intent-model";
import {
  isPromptOutboxPlacementBusy,
  pendingConfigChangesForSessionIntents,
  projectPendingPromptsWithSessionIntents,
  renderableOutboxEntriesForTranscript,
  resolvePromptOutboxPlacement,
  selectNextDispatchableSessionIntent,
} from "./session-intent-selectors";
import {
  patchSessionIntent,
  upsertSessionIntent,
  type SessionIntentStateShape,
} from "./session-intent-state";
import {
  reconcileOutboxFromEnvelopes,
} from "./session-intent-reconciliation";

describe("session intents", () => {
  it("keeps queue-placed sends out of the transcript while preserving failed sends", () => {
    const queued = {
      ...createSendPromptIntent({
        clientPromptId: "prompt-queued",
        clientSessionId: "session-1",
        text: "Run after this turn",
        blocks: [{ type: "text" as const, text: "Run after this turn" }],
        placement: "queue",
      }),
      status: "accepted" as const,
      deliveryState: "accepted_queued" as const,
    };
    const failed = {
      ...createSendPromptIntent({
        clientPromptId: "prompt-failed",
        clientSessionId: "session-1",
        text: "Could not send",
        blocks: [{ type: "text" as const, text: "Could not send" }],
        placement: "queue",
      }),
      status: "failed" as const,
      deliveryState: "failed_before_dispatch" as const,
    };

    expect(renderableOutboxEntriesForTranscript(
      [queued, failed],
      createTranscriptState("session-1"),
    ).map((entry) => entry.clientPromptId)).toEqual(["prompt-failed"]);
  });

  it("dispatches one ordered intent per session at a time", () => {
    let state = emptyState();
    const prompt = createSendPromptIntent({
      clientPromptId: "prompt-1",
      clientSessionId: "session-1",
      text: "Ship it",
      blocks: [{ type: "text", text: "Ship it" }],
    });
    const config = createUpdateConfigIntent({
      intentId: "config-1",
      clientSessionId: "session-1",
      configId: "reasoning",
      value: "high",
    });
    const secondPrompt = createSendPromptIntent({
      clientPromptId: "prompt-2",
      clientSessionId: "session-1",
      text: "Now test it",
      blocks: [{ type: "text", text: "Now test it" }],
    });

    state = upsertSessionIntent(state, prompt);
    state = upsertSessionIntent(state, config);
    state = upsertSessionIntent(state, secondPrompt);

    expect(selectNextDispatchableSessionIntent(state, "session-1")?.intentId).toBe("prompt-1");

    state = patchSessionIntent(state, "prompt-1", {
      status: "accepted",
      deliveryState: "accepted_running",
    });
    expect(selectNextDispatchableSessionIntent(state, "session-1")?.intentId).toBe("config-1");

    state = patchSessionIntent(state, "config-1", {
      status: "accepted",
      applyState: "queued",
    });
    expect(selectNextDispatchableSessionIntent(state, "session-1")?.intentId).toBe("prompt-2");
  });

  it("projects pending config from queued and accepted queued config intents", () => {
    const queued = createUpdateConfigIntent({
      intentId: "config-1",
      clientSessionId: "session-1",
      configId: "effort",
      value: "xhigh",
    });
    const acceptedQueued = {
      ...createUpdateConfigIntent({
        intentId: "config-2",
        clientSessionId: "session-1",
        configId: "mode",
        value: "plan",
      }),
      status: "accepted" as const,
      applyState: "queued" as const,
    };

    expect(pendingConfigChangesForSessionIntents([queued, acceptedQueued])).toMatchObject({
      effort: { rawConfigId: "effort", value: "xhigh", status: "queued" },
      mode: { rawConfigId: "mode", value: "plan", status: "queued" },
    });
  });

  it("holds the optimistic config value through accepted+applied until reconciled (off-by-one fix)", () => {
    const acceptedApplied = {
      ...createUpdateConfigIntent({
        intentId: "config-applied",
        clientSessionId: "session-1",
        configId: "mode",
        value: "plan",
      }),
      status: "accepted" as const,
      applyState: "applied" as const,
    };

    // Held optimistically so the control does not briefly revert to the
    // not-yet-updated server value between the HTTP response and the SSE echo.
    // Status is "settling" (not "submitting") so the held value shows no spinner
    // — the backend already applied it; we are only awaiting the echo.
    expect(pendingConfigChangesForSessionIntents([acceptedApplied])).toMatchObject({
      mode: { rawConfigId: "mode", value: "plan", status: "settling" },
    });

    // Once the authoritative config_option_update reconciles the intent, the
    // optimistic value is released (server value is now authoritative).
    const reconciled = { ...acceptedApplied, status: "reconciled" as const };
    expect(pendingConfigChangesForSessionIntents([reconciled]).mode).toBeUndefined();
  });

  it("does not queue a prompt solely because stale session metadata says busy", () => {
    expect(resolvePromptOutboxPlacement({
      isSessionBusy: isPromptOutboxPlacementBusy({
        transcript: createTranscriptState("session-1"),
        executionSummary: { phase: "running", pendingInteractions: [] },
        status: "running",
        streamConnectionState: "ended",
      }),
      isSessionMaterialized: true,
      existingEntries: [],
    })).toBe("transcript");
  });

  it("queues a prompt when the transcript prompt lane is actually occupied", () => {
    const transcript = createTranscriptState("session-1");
    transcript.turnOrder = ["turn-1"];
    transcript.turnsById["turn-1"] = {
      turnId: "turn-1",
      startedAt: "2026-05-12T00:00:00Z",
      completedAt: null,
      stopReason: null,
      itemOrder: [],
      fileBadges: [],
    };

    expect(isPromptOutboxPlacementBusy({ transcript })).toBe(true);
    expect(resolvePromptOutboxPlacement({
      isSessionBusy: isPromptOutboxPlacementBusy({ transcript }),
      isSessionMaterialized: true,
      existingEntries: [],
    })).toBe("queue");
  });

  it("queues a prompt while a running session is waiting for the stream to catch up", () => {
    for (const streamConnectionState of ["open", "disconnected"] as const) {
      expect(resolvePromptOutboxPlacement({
        isSessionBusy: isPromptOutboxPlacementBusy({
          transcript: createTranscriptState("session-1"),
          executionSummary: { phase: "running", pendingInteractions: [] },
          status: "running",
          streamConnectionState,
        }),
        isSessionMaterialized: true,
        existingEntries: [],
      })).toBe("queue");
    }
  });

  it("skips cancelled and failed intents when selecting the next dispatchable intent", () => {
    let state = emptyState();
    state = upsertSessionIntent(state, {
      ...createSendPromptIntent({
        clientPromptId: "prompt-cancelled",
        clientSessionId: "session-1",
        text: "Skip me",
        blocks: [{ type: "text", text: "Skip me" }],
      }),
      status: "cancelled",
      deliveryState: "cancelled",
    });
    state = upsertSessionIntent(state, {
      ...createUpdateConfigIntent({
        intentId: "config-failed",
        clientSessionId: "session-1",
        configId: "mode",
        value: "plan",
      }),
      status: "failed",
    });
    state = upsertSessionIntent(state, createUpdateConfigIntent({
      intentId: "config-next",
      clientSessionId: "session-1",
      configId: "effort",
      value: "high",
    }));

    expect(selectNextDispatchableSessionIntent(state, "session-1")?.intentId).toBe("config-next");
  });

  it("projects runtime pending prompt edits and deletes from ordered intents", () => {
    const pendingPrompts = [
      {
        seq: 7,
        promptId: "prompt-7",
        text: "before",
        contentParts: [{ type: "text" as const, text: "before" }],
        queuedAt: "2026-05-12T00:00:00Z",
        promptProvenance: null,
      },
      {
        seq: 8,
        promptId: "prompt-8",
        text: "delete me",
        contentParts: [{ type: "text" as const, text: "delete me" }],
        queuedAt: "2026-05-12T00:00:01Z",
        promptProvenance: null,
      },
    ];
    const projected = projectPendingPromptsWithSessionIntents(pendingPrompts, [
      {
        ...createUpdateConfigIntent({
          intentId: "ignored-config",
          clientSessionId: "session-1",
          configId: "mode",
          value: "plan",
        }),
      },
      {
        intentId: "edit-7",
        kind: "edit_pending_prompt",
        clientSessionId: "session-1",
        materializedSessionId: null,
        workspaceId: null,
        status: "queued",
        errorMessage: null,
        createdAt: "2026-05-12T00:00:02Z",
        updatedAt: "2026-05-12T00:00:02Z",
        dispatchedAt: null,
        acceptedAt: null,
        reconciledAt: null,
        seq: 7,
        text: "after",
      },
      {
        intentId: "delete-8",
        kind: "delete_pending_prompt",
        clientSessionId: "session-1",
        materializedSessionId: null,
        workspaceId: null,
        status: "accepted",
        errorMessage: null,
        createdAt: "2026-05-12T00:00:03Z",
        updatedAt: "2026-05-12T00:00:03Z",
        dispatchedAt: null,
        acceptedAt: "2026-05-12T00:00:04Z",
        reconciledAt: null,
        seq: 8,
      },
    ]);

    expect(projected).toEqual([
      expect.objectContaining({
        seq: 7,
        text: "after",
        contentParts: [{ type: "text", text: "after" }],
      }),
    ]);
  });

  it("reconciles prompts, config, and interactions from stream envelopes", () => {
    let state = emptyState();
    state = upsertSessionIntent(state, createSendPromptIntent({
      clientPromptId: "prompt-1",
      clientSessionId: "session-1",
      text: "Ship it",
      blocks: [{ type: "text", text: "Ship it" }],
    }));
    state = upsertSessionIntent(state, {
      ...createUpdateConfigIntent({
        intentId: "config-1",
        clientSessionId: "session-1",
        configId: "effort",
        value: "high",
      }),
      status: "accepted",
      applyState: "queued",
    });
    state = upsertSessionIntent(state, {
      ...createResolveInteractionIntent({
        intentId: "interaction-1",
        clientSessionId: "session-1",
        action: "permission",
        requestId: "request-1",
        request: { outcome: "decision", decision: "allow" },
      }),
      status: "accepted",
    });

    const next = reconcileOutboxFromEnvelopes(state, "session-1", [
      {
        seq: 1,
        timestamp: "2026-05-12T00:00:00Z",
        event: {
          type: "item_completed",
          item: {
            kind: "user_message",
            itemId: "item-1",
            promptId: "prompt-1",
            text: "Ship it",
            contentParts: [{ type: "text", text: "Ship it" }],
          },
        },
        sessionId: "session-1",
      } as unknown as SessionEventEnvelope,
      {
        seq: 2,
        timestamp: "2026-05-12T00:00:01Z",
        event: {
          type: "config_option_update",
          liveConfig: liveConfig("effort", "high"),
        },
        sessionId: "session-1",
      } as SessionEventEnvelope,
      {
        seq: 3,
        timestamp: "2026-05-12T00:00:02Z",
        event: {
          type: "interaction_resolved",
          requestId: "request-1",
          kind: "permission",
          outcome: { type: "decision", decision: "allow" },
        },
        sessionId: "session-1",
      } as unknown as SessionEventEnvelope,
    ]);

    expect(next.entriesById["prompt-1"]).toMatchObject({
      kind: "send_prompt",
      deliveryState: "echoed_tombstone",
    });
    expect(next.entriesById["config-1"]).toMatchObject({
      kind: "update_config",
      status: "reconciled",
    });
    expect(next.entriesById["interaction-1"]).toMatchObject({
      kind: "resolve_interaction",
      status: "reconciled",
    });
  });

  it("preserves immutable queue seqs while reconciling a reorder event", () => {
    let state = emptyState();
    state = upsertSessionIntent(state, {
      ...createSendPromptIntent({
        clientPromptId: "prompt-1",
        clientSessionId: "session-1",
        text: "Ship it",
        blocks: [{ type: "text", text: "Ship it" }],
        placement: "queue",
      }),
      status: "accepted",
      deliveryState: "accepted_queued",
      queuedSeq: 7,
    });
    state = upsertSessionIntent(state, {
      ...createSendPromptIntent({
        clientPromptId: "prompt-2",
        clientSessionId: "session-1",
        text: "Then verify it",
        blocks: [{ type: "text", text: "Then verify it" }],
        placement: "queue",
      }),
      status: "accepted",
      deliveryState: "accepted_queued",
      queuedSeq: 8,
    });

    const next = reconcileOutboxFromEnvelopes(state, "session-1", [{
      sessionId: "session-1",
      seq: 9,
      timestamp: "2026-05-12T00:00:09Z",
      event: {
        type: "pending_prompts_reordered",
        pendingPrompts: [
          {
            seq: 8,
            promptId: "prompt-2",
            text: "Then verify it",
            contentParts: [{ type: "text", text: "Then verify it" }],
            queuedAt: "2026-05-12T00:00:01Z",
            promptProvenance: null,
          },
          {
            seq: 7,
            promptId: "prompt-1",
            text: "Ship it",
            contentParts: [{ type: "text", text: "Ship it" }],
            queuedAt: "2026-05-12T00:00:00Z",
            promptProvenance: null,
          },
        ],
      },
    }]);

    expect(next.entriesById["prompt-1"]).toMatchObject({
      queuedSeq: 7,
      placement: "queue",
      deliveryState: "accepted_queued",
    });
    expect(next.entriesById["prompt-2"]).toMatchObject({
      queuedSeq: 8,
      placement: "queue",
      deliveryState: "accepted_queued",
    });
  });

  it("only reconciles config and interaction intents for the streamed client session", () => {
    let state = emptyState();
    state = upsertSessionIntent(state, {
      ...createUpdateConfigIntent({
        intentId: "config-session-1",
        clientSessionId: "session-1",
        configId: "effort",
        value: "high",
      }),
      status: "accepted",
      applyState: "queued",
    });
    state = upsertSessionIntent(state, {
      ...createUpdateConfigIntent({
        intentId: "config-session-2",
        clientSessionId: "session-2",
        configId: "effort",
        value: "high",
      }),
      status: "accepted",
      applyState: "queued",
    });
    state = upsertSessionIntent(state, {
      ...createResolveInteractionIntent({
        intentId: "interaction-session-1",
        clientSessionId: "session-1",
        action: "permission",
        requestId: "request-shared",
        request: { outcome: "decision", decision: "allow" },
      }),
      status: "accepted",
    });
    state = upsertSessionIntent(state, {
      ...createResolveInteractionIntent({
        intentId: "interaction-session-2",
        clientSessionId: "session-2",
        action: "permission",
        requestId: "request-shared",
        request: { outcome: "decision", decision: "allow" },
      }),
      status: "accepted",
    });

    const next = reconcileOutboxFromEnvelopes(state, "session-1", [
      {
        seq: 1,
        timestamp: "2026-05-12T00:00:00Z",
        event: {
          type: "config_option_update",
          liveConfig: liveConfig("effort", "high"),
        },
        sessionId: "session-1",
      } as SessionEventEnvelope,
      {
        seq: 2,
        timestamp: "2026-05-12T00:00:01Z",
        event: {
          type: "interaction_resolved",
          requestId: "request-shared",
          kind: "permission",
          outcome: { type: "decision", decision: "allow" },
        },
        sessionId: "session-1",
      } as unknown as SessionEventEnvelope,
    ]);

    expect(next.entriesById["config-session-1"]).toMatchObject({
      status: "reconciled",
    });
    expect(next.entriesById["interaction-session-1"]).toMatchObject({
      status: "reconciled",
    });
    expect(next.entriesById["config-session-2"]).toMatchObject({
      status: "accepted",
    });
    expect(next.entriesById["interaction-session-2"]).toMatchObject({
      status: "accepted",
    });
  });
});

function emptyState(): SessionIntentStateShape {
  return {
    entriesById: {},
    intentIdsByClientSessionId: {},
  };
}

function liveConfig(rawConfigId: string, currentValue: string): SessionLiveConfigSnapshot {
  return {
    sourceSeq: 1,
    rawConfigOptions: [
      {
        id: rawConfigId,
        name: rawConfigId,
        type: "select",
        currentValue,
        options: [],
      },
    ],
    normalizedControls: {
      model: null,
      collaborationMode: null,
      mode: null,
      reasoning: {
        rawConfigId,
        key: "reasoning",
        label: "Reasoning",
        currentValue,
        settable: true,
        values: [],
      },
      effort: null,
      fastMode: null,
      extras: [],
    },
    promptCapabilities: undefined,
    updatedAt: "2026-05-12T00:00:00Z",
  };
}
