import { afterEach, describe, expect, it } from "vitest";
import {
  requestSessionModelAvailabilityDecision,
  SessionModelAvailabilityBusyError,
} from "@/hooks/sessions/use-session-model-availability-workflow";
import {
  resetSessionModelAvailabilityStore,
  useSessionModelAvailabilityStore,
  type PausedSessionModelAvailability,
} from "@/stores/sessions/model-availability-store";

const PAUSED_LAUNCH: PausedSessionModelAvailability = {
  id: "session-1:gpt-5.5:gpt-5.4",
  sessionId: "session-1",
  workspaceId: "workspace-1",
  agentKind: "codex",
  providerDisplayName: "Codex",
  requestedModelId: "gpt-5.5",
  requestedModelDisplayName: "GPT 5.5",
  currentModelId: "gpt-5.4",
  currentModelDisplayName: "GPT 5.4",
  remediation: {
    kind: "managed_reinstall",
    message: "Update Codex tools and retry.",
  },
};

describe("requestSessionModelAvailabilityDecision", () => {
  afterEach(() => {
    resetSessionModelAvailabilityStore();
  });

  it("stores the paused launch and resolves through the workflow store", async () => {
    const decisionPromise = requestSessionModelAvailabilityDecision(PAUSED_LAUNCH);

    expect(useSessionModelAvailabilityStore.getState().pausedLaunch).toEqual(PAUSED_LAUNCH);

    const resolveDecision = useSessionModelAvailabilityStore.getState().resolveDecision;
    expect(resolveDecision).toBeTypeOf("function");
    useSessionModelAvailabilityStore.getState().clearPendingDecision();
    resolveDecision?.({ kind: "use_current" });

    await expect(decisionPromise).resolves.toEqual({ kind: "use_current" });
    expect(useSessionModelAvailabilityStore.getState().pausedLaunch).toBeNull();
  });

  it("rejects overlapping decisions instead of cancelling the first request", async () => {
    const firstDecision = requestSessionModelAvailabilityDecision(PAUSED_LAUNCH);

    await expect(requestSessionModelAvailabilityDecision({
      ...PAUSED_LAUNCH,
      id: "session-2:gpt-5.5:gpt-5.4",
      sessionId: "session-2",
    })).rejects.toBeInstanceOf(SessionModelAvailabilityBusyError);

    const resolveDecision = useSessionModelAvailabilityStore.getState().resolveDecision;
    useSessionModelAvailabilityStore.getState().clearPendingDecision();
    resolveDecision?.({ kind: "cancel" });
    await expect(firstDecision).resolves.toEqual({ kind: "cancel" });
  });
});
