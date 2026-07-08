// @vitest-environment jsdom

import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSessionIntentActions } from "@/hooks/sessions/workflows/use-session-intent-actions";
import { useSessionIntentStore } from "@/stores/sessions/session-intent-store";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";

const mocks = vi.hoisted(() => ({
  getSessionRecord: vi.fn(),
  patchSessionRecord: vi.fn(),
}));

vi.mock("@/stores/sessions/session-records", () => ({
  getSessionRecord: mocks.getSessionRecord,
  patchSessionRecord: mocks.patchSessionRecord,
}));

vi.mock("@/hooks/workspaces/derived/use-workspace-runtime-block", () => ({
  useWorkspaceRuntimeBlock: () => ({
    getWorkspaceRuntimeBlockReason: () => null,
  }),
}));

vi.mock("@/hooks/sessions/workflows/use-session-interaction-resolution-actions", () => ({
  useSessionInteractionResolutionActions: () => ({
    resolvePermission: vi.fn(),
    resolveMcpElicitation: vi.fn(),
    resolveUserInput: vi.fn(),
    revealMcpElicitationUrl: vi.fn(),
  }),
}));

vi.mock("@/lib/infra/measurement/debug-measurement", () => ({
  finishOrCancelMeasurementOperation: vi.fn(),
  markOperationForNextCommit: vi.fn(),
  recordMeasurementWorkflowStep: vi.fn(),
}));

vi.mock("@/lib/infra/measurement/latency-flow", () => ({
  finishLatencyFlow: vi.fn(),
}));

vi.mock("@/lib/infra/measurement/debug-latency", () => ({
  logLatency: vi.fn(),
}));

vi.mock("@/lib/infra/scheduling/schedule-after-next-paint", () => ({
  scheduleAfterNextPaint: (cb: () => void) => cb(),
}));

const SESSION_ID = "client-session-1";

interface SlotOverrides {
  materialized?: boolean;
  isStreaming?: boolean;
  runtimePendingPromptCount?: number;
}

function setSlot({
  materialized = true,
  isStreaming = true,
  runtimePendingPromptCount = 0,
}: SlotOverrides = {}) {
  mocks.getSessionRecord.mockReturnValue({
    workspaceId: "workspace-1",
    materializedSessionId: materialized ? "session-1" : null,
    status: "running",
    streamConnectionState: "open",
    executionSummary: null,
    transcript: {
      isStreaming,
      pendingInteractions: [],
      pendingPrompts: Array.from({ length: runtimePendingPromptCount }, (_, i) => ({
        seq: i + 1,
      })),
      turnOrder: [],
      turnsById: {},
    },
  });
}

function autoSteerFor(promptId: string): boolean {
  const entry = useSessionIntentStore.getState().entriesById[promptId];
  if (!entry || entry.kind !== "send_prompt") {
    throw new Error(`no send_prompt intent for ${promptId}`);
  }
  return entry.autoSteerOnQueue;
}

async function send(promptId: string) {
  const { result } = renderHook(() => useSessionIntentActions());
  await result.current.sendPrompt({
    sessionId: SESSION_ID,
    text: promptId,
    promptId,
  });
}

describe("useSessionIntentActions auto-steer eligibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSessionIntentStore.getState().clear();
    useUserPreferencesStore.getState().set("busySendBehavior", "interrupt");
    setSlot();
  });

  it("auto-steers only the first prompt of a burst into a busy, materialized session", async () => {
    setSlot({ materialized: true, isStreaming: true, runtimePendingPromptCount: 0 });

    await send("p1");
    await send("p2");
    await send("p3");

    expect(autoSteerFor("p1")).toBe(true);
    expect(autoSteerFor("p2")).toBe(false);
    expect(autoSteerFor("p3")).toBe(false);
  });

  it("does not auto-steer when runtime pending prompts already exist (empty outbox)", async () => {
    setSlot({ materialized: true, isStreaming: false, runtimePendingPromptCount: 1 });

    await send("p1");

    expect(autoSteerFor("p1")).toBe(false);
  });

  it("does not auto-steer when the session is not yet materialized", async () => {
    setSlot({ materialized: false, isStreaming: true, runtimePendingPromptCount: 0 });

    await send("p1");

    expect(autoSteerFor("p1")).toBe(false);
  });

  it("does not auto-steer when the busy-send preference is 'queue'", async () => {
    useUserPreferencesStore.getState().set("busySendBehavior", "queue");
    setSlot({ materialized: true, isStreaming: true, runtimePendingPromptCount: 0 });

    await send("p1");

    expect(autoSteerFor("p1")).toBe(false);
  });
});
