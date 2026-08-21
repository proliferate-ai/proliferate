import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionEventEnvelope } from "@anyharness/sdk";
import { replaySessionHistory } from "#product/lib/domain/sessions/stream/stream-state";
import {
  createEmptySessionRecord,
  getSessionRecord,
  patchSessionRecord,
  putSessionRecord,
} from "#product/stores/sessions/session-records";
import { useSessionDirectoryStore } from "#product/stores/sessions/session-directory-store";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import { useSessionIngestStore } from "#product/stores/sessions/session-ingest-store";
import { useSessionTranscriptStore } from "#product/stores/sessions/session-transcript-store";
import { clearPendingConfigRollbackCheck } from "#product/hooks/sessions/lifecycle/session-runtime-pending-config";
import {
  animationFrameSessionStreamFlushScheduler,
  createSessionStreamFlushController,
  type SessionStreamFlushScheduler,
} from "#product/hooks/sessions/lifecycle/use-session-stream-flush";
import type { SessionStreamFlushFactoryDeps } from "#product/hooks/sessions/lifecycle/session-stream-flush-types";
import type { SessionStreamCache } from "#product/hooks/sessions/cache/use-session-stream-cache";

const originalPatchTranscriptEntry = useSessionTranscriptStore.getState().patchEntry;

describe("session stream flush controller", () => {
  afterEach(() => {
    clearPendingConfigRollbackCheck("session-1");
    useSessionIngestStore.getState().clear();
    useSessionTranscriptStore.setState({ patchEntry: originalPatchTranscriptEntry });
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    const state = replaySessionHistory("session-1", [turnStarted(1)]);
    useSessionSelectionStore.setState({
      selectedWorkspaceId: "workspace-1",
      activeSessionId: "session-1",
    });
    useSessionDirectoryStore.getState().clearEntries();
    useSessionIngestStore.getState().clear();
    useSessionTranscriptStore.getState().clearEntries();
    putSessionRecord({
      ...createEmptySessionRecord("session-1", "codex", {
        workspaceId: "workspace-1",
      }),
      events: state.events,
      transcript: state.transcript,
      transcriptHydrated: true,
      streamConnectionState: "open",
    });
  });

  it("applies queued stream events with one store patch per scheduled flush", () => {
    const scheduled = createManualScheduler();
    const patchSpy = spyOnTranscriptPatch();
    const reconcileWorkspacePinIntents = vi.fn<
      SessionStreamFlushFactoryDeps["reconcileWorkspacePinIntents"]
    >();
    const controller = createTestController({
      scheduler: scheduled.scheduler,
      reconcileWorkspacePinIntents,
    });

    controller.enqueue(assistantStarted(2, "assistant-1", "Hel"));
    controller.enqueue(assistantDelta(3, "assistant-1", "lo"));
    controller.enqueue(assistantCompleted(4, "assistant-1", "Hello"));
    controller.enqueue(workspacePinIntent(5));

    expect(patchSpy).not.toHaveBeenCalled();
    scheduled.flush();

    expect(patchSpy).toHaveBeenCalledTimes(1);
    const slot = getSessionRecord("session-1")!;
    expect(slot.events.map((event) => event.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(slot.transcript.lastSeq).toBe(5);
    expect(reconcileWorkspacePinIntents).toHaveBeenCalledTimes(1);
    expect(reconcileWorkspacePinIntents.mock.calls[0]?.[0].map((event) => event.seq))
      .toEqual([2, 3, 4, 5]);
  });

  it("does not clear a recorded gap on a duplicate-only flush", () => {
    useSessionIngestStore.getState().markStale("session-1", {
      lastAppliedSeq: 1,
      lastObservedSeq: 3,
      gapAfterSeq: 1,
    });
    const scheduled = createManualScheduler();
    const controller = createTestController({ scheduler: scheduled.scheduler });

    controller.enqueue(turnStarted(1));
    scheduled.flush();

    expect(useSessionIngestStore.getState().freshnessByClientSessionId["session-1"])
      .toMatchObject({
        freshness: "stale",
        gapAfterSeq: 1,
      });
  });

  it("clears optimistic prompt when the stream echoes the user message", () => {
    const scheduled = createManualScheduler();
    const controller = createTestController({ scheduler: scheduled.scheduler });
    patchSessionRecord("session-1", {
      optimisticPrompt: {
        seq: -1,
        promptId: "prompt-1",
        text: "Ship it",
        contentParts: [{ type: "text", text: "Ship it" }],
        queuedAt: "2026-04-04T00:00:01Z",
        promptProvenance: null,
      },
    });

    controller.enqueue(userStarted(2, "user-1", "Ship it"));
    scheduled.flush();

    expect(getSessionRecord("session-1")?.optimisticPrompt).toBeNull();
  });

  it("keeps optimistic prompt during status-only stream events", () => {
    const scheduled = createManualScheduler();
    const controller = createTestController({ scheduler: scheduled.scheduler });
    patchSessionRecord("session-1", {
      optimisticPrompt: {
        seq: -1,
        promptId: "prompt-1",
        text: "Ship it",
        contentParts: [{ type: "text", text: "Ship it" }],
        queuedAt: "2026-04-04T00:00:01Z",
        promptProvenance: null,
      },
    });

    controller.enqueue(sessionStateUpdate(2));
    scheduled.flush();

    expect(getSessionRecord("session-1")?.optimisticPrompt?.text).toBe("Ship it");
  });

  it("applies a contiguous prefix before a gap, reconciles history, and reconnects", async () => {
    const scheduled = createManualScheduler();
    const patchSpy = spyOnTranscriptPatch();
    const closeCurrentHandle = vi.fn();
    const scheduleReconnect = vi.fn();
    const scheduleImmediateReconnect = vi.fn();
    let resolveRehydrate: (applied: boolean) => void = () => {};
    const rehydrateSessionSlotFromHistory = vi.fn().mockReturnValue(
      new Promise<boolean>((resolve) => {
        resolveRehydrate = resolve;
      }),
    );
    const controller = createTestController({
      scheduler: scheduled.scheduler,
      closeCurrentHandle,
      scheduleReconnect,
      scheduleImmediateReconnect,
      rehydrateSessionSlotFromHistory,
    });

    controller.enqueue(assistantStarted(2, "assistant-1", "Hel"));
    controller.enqueue(turnEnded(4));
    scheduled.flush();

    expect(patchSpy).toHaveBeenCalledTimes(1);
    const slot = getSessionRecord("session-1")!;
    expect(slot.events.map((event) => event.seq)).toEqual([1, 2]);
    expect(slot.transcript.lastSeq).toBe(2);
    expect(slot.streamConnectionState).toBe("disconnected");
    expect(rehydrateSessionSlotFromHistory).toHaveBeenCalledWith("session-1", expect.objectContaining({
      afterSeq: 2,
      timeoutMs: 5_000,
    }));
    expect(closeCurrentHandle).toHaveBeenCalledTimes(1);
    // Before the reconcile settles, nothing is scheduled either way.
    expect(scheduleReconnect).not.toHaveBeenCalled();
    expect(scheduleImmediateReconnect).not.toHaveBeenCalled();
    resolveRehydrate(false);
    await new Promise((resolve) => setTimeout(resolve, 0));
    // A gap-reconcile forced reconnect uses the bypass-backoff immediate path,
    // NOT the shared error-retry curve (Q9). Negative control: the ordinary
    // curve-advancing scheduleReconnect must never fire for this path.
    expect(scheduleImmediateReconnect).toHaveBeenCalledTimes(1);
    expect(scheduleReconnect).not.toHaveBeenCalled();
  });

  it("keeps the active summary refresh scheduled when a new turn starts after a turn end in one flush", () => {
    const scheduled = createManualScheduler();
    const clearActiveSummaryRefreshTimer = vi.fn();
    const scheduleActiveSummaryRefresh = vi.fn();
    const controller = createTestController({
      scheduler: scheduled.scheduler,
      clearActiveSummaryRefreshTimer,
      scheduleActiveSummaryRefresh,
    });

    controller.enqueue(turnEnded(2));
    controller.enqueue(turnStarted(3, "turn-2"));
    scheduled.flush();

    expect(scheduleActiveSummaryRefresh).toHaveBeenCalledTimes(1);
    if (clearActiveSummaryRefreshTimer.mock.invocationCallOrder.length > 0) {
      expect(clearActiveSummaryRefreshTimer.mock.invocationCallOrder[0]).toBeLessThan(
        scheduleActiveSummaryRefresh.mock.invocationCallOrder[0]!,
      );
    }
  });

  it("clears pending config rollback when a new turn starts after a turn end in one flush", () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", {
      clearTimeout,
      setTimeout,
    });
    const scheduled = createManualScheduler();
    const refreshSessionSlotMeta = vi.fn().mockResolvedValue(undefined);
    const controller = createTestController({
      scheduler: scheduled.scheduler,
      refreshSessionSlotMeta,
    });
    patchSessionRecord("session-1", {
      pendingConfigChanges: {
        effort: {
          rawConfigId: "effort",
          value: "high",
          status: "queued",
          mutationId: 1,
        },
      },
    });

    controller.enqueue(turnEnded(2));
    controller.enqueue(turnStarted(3, "turn-2"));
    scheduled.flush();
    vi.advanceTimersByTime(300);

    expect(refreshSessionSlotMeta).not.toHaveBeenCalled();
  });

  it("flushes with the fallback timer when requestAnimationFrame does not run", () => {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const patchSpy = spyOnTranscriptPatch();
    const controller = createTestController();

    controller.enqueue(assistantStarted(2, "assistant-1", "Hello"));
    expect(patchSpy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);

    expect(patchSpy).toHaveBeenCalledTimes(1);
    const slot = getSessionRecord("session-1")!;
    expect(slot.events.map((event) => event.seq)).toEqual([1, 2]);
  });

  it("flushes with a max-delay timer when animation frames do not run", () => {
    vi.useFakeTimers();
    const callback = vi.fn();
    const requestAnimationFrame = vi.fn(() => 42);
    const cancelAnimationFrame = vi.fn();
    vi.stubGlobal("requestAnimationFrame", requestAnimationFrame);
    vi.stubGlobal("cancelAnimationFrame", cancelAnimationFrame);

    animationFrameSessionStreamFlushScheduler.schedule(callback);

    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
    expect(callback).not.toHaveBeenCalled();

    vi.runOnlyPendingTimers();

    expect(callback).toHaveBeenCalledTimes(1);
    expect(cancelAnimationFrame).toHaveBeenCalledWith(42);
  });

  it("cancels both the frame and max-delay timer", () => {
    vi.useFakeTimers();
    const callback = vi.fn();
    const requestAnimationFrame = vi.fn(() => 42);
    const cancelAnimationFrame = vi.fn();
    vi.stubGlobal("requestAnimationFrame", requestAnimationFrame);
    vi.stubGlobal("cancelAnimationFrame", cancelAnimationFrame);

    const cancel = animationFrameSessionStreamFlushScheduler.schedule(callback);
    cancel();
    vi.runOnlyPendingTimers();

    expect(callback).not.toHaveBeenCalled();
    expect(cancelAnimationFrame).toHaveBeenCalledWith(42);
  });
});

function createTestController(options?: {
  scheduler?: SessionStreamFlushScheduler;
  closeCurrentHandle?: () => void;
  scheduleReconnect?: () => void;
  scheduleImmediateReconnect?: () => void;
  clearActiveSummaryRefreshTimer?: () => void;
  scheduleActiveSummaryRefresh?: () => void;
  refreshSessionSlotMeta?: () => Promise<void>;
  rehydrateSessionSlotFromHistory?: () => Promise<boolean>;
  reconcileWorkspacePinIntents?: SessionStreamFlushFactoryDeps["reconcileWorkspacePinIntents"];
}) {
  return createSessionStreamFlushController({
    sessionStreamCache: createTestSessionStreamCache(),
    mountSubagentChildSession: vi.fn(),
    persistReconciledControlPreferences: vi.fn(),
    refreshSessionSlotMeta: options?.refreshSessionSlotMeta ?? vi.fn(),
    rehydrateSessionSlotFromHistory: options?.rehydrateSessionSlotFromHistory ?? vi.fn().mockResolvedValue(false),
    reconcileWorkspacePinIntents: options?.reconcileWorkspacePinIntents ?? vi.fn(),
    showToast: vi.fn(),
    scheduler: options?.scheduler,
    sessionId: "session-1",
    streamMeasurementOperationId: null,
    isStillCurrent: () => true,
    isCurrentStream: () => true,
    closeCurrentHandle: options?.closeCurrentHandle ?? vi.fn(),
    scheduleReconnect: options?.scheduleReconnect ?? vi.fn(),
    scheduleImmediateReconnect: options?.scheduleImmediateReconnect ?? vi.fn(),
    clearActiveSummaryRefreshTimer: options?.clearActiveSummaryRefreshTimer ?? vi.fn(),
    scheduleActiveSummaryRefresh: options?.scheduleActiveSummaryRefresh ?? vi.fn(),
    scheduleStartupReadyRefresh: vi.fn(),
  });
}

function createTestSessionStreamCache(): SessionStreamCache {
  return {
    invalidateWorkspaceCollections: vi.fn(),
    invalidateSessionSubagents: vi.fn(),
    invalidateCoworkManagedWorkspaces: vi.fn(),
    invalidateSessionReviews: vi.fn(),
    invalidateGitStatus: vi.fn(),
    refreshPrStatuses: vi.fn(),
  };
}

function createManualScheduler() {
  let callback: (() => void) | null = null;
  return {
    scheduler: {
      schedule(nextCallback: () => void) {
        callback = nextCallback;
        return () => {
          callback = null;
        };
      },
    } satisfies SessionStreamFlushScheduler,
    flush() {
      const nextCallback = callback;
      callback = null;
      nextCallback?.();
    },
  };
}

function spyOnTranscriptPatch() {
  const patchSpy = vi.fn(originalPatchTranscriptEntry);
  useSessionTranscriptStore.setState({
    patchEntry: patchSpy,
  });
  return patchSpy;
}

function turnStarted(seq: number, turnId = "turn-1"): SessionEventEnvelope {
  return {
    sessionId: "session-1",
    seq,
    timestamp: `2026-04-04T00:00:0${seq}Z`,
    turnId,
    event: { type: "turn_started" },
  };
}

function turnEnded(seq: number): SessionEventEnvelope {
  return {
    sessionId: "session-1",
    seq,
    timestamp: `2026-04-04T00:00:0${seq}Z`,
    turnId: "turn-1",
    event: { type: "turn_ended", stopReason: "end_turn" },
  };
}

function assistantStarted(
  seq: number,
  itemId: string,
  text: string,
): SessionEventEnvelope {
  return {
    sessionId: "session-1",
    seq,
    timestamp: `2026-04-04T00:00:0${seq}Z`,
    turnId: "turn-1",
    itemId,
    event: {
      type: "item_started",
      item: {
        kind: "assistant_message",
        status: "in_progress",
        sourceAgentKind: "claude",
        contentParts: [{ type: "text", text }],
      },
    },
  };
}

function userStarted(
  seq: number,
  itemId: string,
  text: string,
): SessionEventEnvelope {
  return {
    sessionId: "session-1",
    seq,
    timestamp: `2026-04-04T00:00:0${seq}Z`,
    turnId: "turn-1",
    itemId,
    event: {
      type: "item_started",
      item: {
        kind: "user_message",
        status: "completed",
        sourceAgentKind: "codex",
        contentParts: [{ type: "text", text }],
      },
    },
  };
}

function sessionStateUpdate(seq: number): SessionEventEnvelope {
  return {
    sessionId: "session-1",
    seq,
    timestamp: `2026-04-04T00:00:0${seq}Z`,
    turnId: "turn-1",
    event: {
      type: "session_state_update",
      modelId: "codex-model",
    },
  };
}

function workspacePinIntent(seq: number): SessionEventEnvelope {
  return {
    sessionId: "session-1",
    seq,
    timestamp: `2026-04-04T00:00:0${seq}Z`,
    event: {
      type: "workspace_pin_intent",
      requestId: "11111111-1111-4111-8111-111111111111",
      runtimeId: "runtime-1",
      sourceSessionId: "session-1",
      workspaceId: "workspace-1",
      pinned: true,
    },
  };
}

function assistantDelta(
  seq: number,
  itemId: string,
  appendText: string,
): SessionEventEnvelope {
  return {
    sessionId: "session-1",
    seq,
    timestamp: `2026-04-04T00:00:0${seq}Z`,
    turnId: "turn-1",
    itemId,
    event: {
      type: "item_delta",
      delta: {
        appendText,
      },
    },
  };
}

function assistantCompleted(
  seq: number,
  itemId: string,
  text: string,
): SessionEventEnvelope {
  return {
    sessionId: "session-1",
    seq,
    timestamp: `2026-04-04T00:00:0${seq}Z`,
    turnId: "turn-1",
    itemId,
    event: {
      type: "item_completed",
      item: {
        kind: "assistant_message",
        status: "completed",
        sourceAgentKind: "claude",
        contentParts: [{ type: "text", text }],
      },
    },
  };
}
