import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDebugMeasurementDump } from "@/lib/infra/measurement/debug-measurement-dump";
import { resetDebugMeasurementForTest } from "@/lib/infra/measurement/debug-measurement";
import { useSessionIntentStore } from "@/stores/sessions/session-intent-store";

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
});
