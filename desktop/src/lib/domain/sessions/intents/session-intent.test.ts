import type {
  SessionEventEnvelope,
  SessionLiveConfigSnapshot,
} from "@anyharness/sdk";
import { describe, expect, it } from "vitest";
import {
  createResolveInteractionIntent,
  createSendPromptIntent,
  createUpdateConfigIntent,
} from "@/lib/domain/sessions/intents/session-intent-model";
import {
  pendingConfigChangesForSessionIntents,
  projectPendingPromptsWithSessionIntents,
  selectNextDispatchableSessionIntent,
} from "@/lib/domain/sessions/intents/session-intent-selectors";
import {
  patchSessionIntent,
  upsertSessionIntent,
  type SessionIntentStateShape,
} from "@/lib/domain/sessions/intents/session-intent-state";
import {
  reconcileOutboxFromEnvelopes,
} from "@/lib/domain/sessions/intents/session-intent-reconciliation";

describe("session intents", () => {
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
