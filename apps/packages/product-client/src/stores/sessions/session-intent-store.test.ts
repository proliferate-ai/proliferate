import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDebugMeasurementDump } from "#product/lib/infra/measurement/measurement-port";
import { resetDebugMeasurementForTest } from "#product/lib/infra/measurement/measurement-port";
import { useSessionIntentStore } from "#product/stores/sessions/session-intent-store";

describe("session intent store", () => {
  beforeEach(() => {
    useSessionIntentStore.getState().clear();
    resetDebugMeasurementForTest();
  });

  afterEach(() => {
    useSessionIntentStore.getState().clear();
    resetDebugMeasurementForTest();
    vi.unstubAllEnvs();
  });

  it("records narrow store-action attribution for prompt enqueue", () => {
    vi.stubEnv("VITE_PROLIFERATE_DEBUG_MAIN_THREAD", "1");

    useSessionIntentStore.getState().enqueuePrompt({
      clientPromptId: "prompt-1",
      clientSessionId: "session-1",
      workspaceId: "workspace-1",
      text: "Ship it",
      blocks: [{ type: "text", text: "Ship it" }],
    });

    const dump = getDebugMeasurementDump();
    expect(dump.recentDebugActivities).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "store_action",
        label: "session-intent-store.enqueuePrompt",
        metadata: expect.objectContaining({
          afterCount: 1,
          beforeCount: 0,
          clientSessionId: "session-1",
          intentKind: "send_prompt",
          totalAfterCount: 1,
          totalBeforeCount: 0,
          workspaceId: "workspace-1",
        }),
      }),
    ]));
  });

  it("supersedes a queued tail config intent in place during a fast cycling burst", () => {
    const store = useSessionIntentStore.getState();
    const first = store.enqueueConfig({
      clientSessionId: "session-1",
      workspaceId: "workspace-1",
      configId: "mode",
      value: "plan",
    });
    store.enqueueConfig({
      clientSessionId: "session-1",
      workspaceId: "workspace-1",
      configId: "mode",
      value: "accept",
    });
    const last = store.enqueueConfig({
      clientSessionId: "session-1",
      workspaceId: "workspace-1",
      configId: "mode",
      value: "default",
    });

    const state = useSessionIntentStore.getState();
    expect(state.intentIdsByClientSessionId["session-1"]).toEqual([first.intentId]);
    expect(last.intentId).toBe(first.intentId);
    expect(state.entriesById[first.intentId]).toMatchObject({
      configId: "mode",
      status: "queued",
      value: "default",
    });
  });

  it("does not coalesce a config change past another intent or into an in-flight one", () => {
    const store = useSessionIntentStore.getState();
    const beforePrompt = store.enqueueConfig({
      clientSessionId: "session-1",
      workspaceId: "workspace-1",
      configId: "mode",
      value: "plan",
    });
    store.enqueuePrompt({
      clientPromptId: "prompt-1",
      clientSessionId: "session-1",
      workspaceId: "workspace-1",
      text: "Ship it",
      blocks: [{ type: "text", text: "Ship it" }],
    });
    // The prompt must still run under "plan": superseding across it would
    // reorder config work relative to the prompt.
    const afterPrompt = store.enqueueConfig({
      clientSessionId: "session-1",
      workspaceId: "workspace-1",
      configId: "mode",
      value: "accept",
    });
    expect(afterPrompt.intentId).not.toBe(beforePrompt.intentId);

    // A dispatching tail is already on the wire with its old value.
    store.patchIntent(afterPrompt.intentId, { status: "dispatching" });
    const afterDispatch = store.enqueueConfig({
      clientSessionId: "session-1",
      workspaceId: "workspace-1",
      configId: "mode",
      value: "default",
    });
    expect(afterDispatch.intentId).not.toBe(afterPrompt.intentId);

    // A different config option at the tail is its own selection.
    const otherConfig = store.enqueueConfig({
      clientSessionId: "session-1",
      workspaceId: "workspace-1",
      configId: "effort",
      value: "high",
    });
    expect(otherConfig.intentId).not.toBe(afterDispatch.intentId);

    expect(useSessionIntentStore.getState().intentIdsByClientSessionId["session-1"]).toEqual([
      beforePrompt.intentId,
      "prompt-1",
      afterPrompt.intentId,
      afterDispatch.intentId,
      otherConfig.intentId,
    ]);
  });
});
