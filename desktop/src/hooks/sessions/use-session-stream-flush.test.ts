import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionEventEnvelope } from "@anyharness/sdk";
import { createEmptySessionSlot } from "@/lib/integrations/anyharness/session-runtime";
import { replaySessionHistory } from "@/lib/integrations/anyharness/session-stream-state";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { clearPendingConfigRollbackCheck } from "@/hooks/sessions/session-runtime-pending-config";
import {
  createSessionStreamFlushController,
  type SessionStreamFlushScheduler,
} from "@/hooks/sessions/use-session-stream-flush";

const originalPatchSessionSlot = useHarnessStore.getState().patchSessionSlot;

describe("session stream flush controller", () => {
  afterEach(() => {
    clearPendingConfigRollbackCheck("session-1");
    useHarnessStore.setState({ patchSessionSlot: originalPatchSessionSlot });
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    const state = replaySessionHistory("session-1", [turnStarted(1)]);
    useHarnessStore.setState({
      runtimeUrl: "http://runtime.test",
      selectedWorkspaceId: "workspace-1",
      activeSessionId: "session-1",
      sessionSlots: {
        "session-1": {
          ...createEmptySessionSlot("session-1", "codex", {
            workspaceId: "workspace-1",
          }),
          events: state.events,
          transcript: state.transcript,
          transcriptHydrated: true,
          streamConnectionState: "open",
        },
      },
    });
  });

  it("applies queued stream events with one store patch per scheduled flush", () => {
    const scheduled = createManualScheduler();
    const patchSpy = spyOnPatchSessionSlot();
    const controller = createTestController({ scheduler: scheduled.scheduler });

    controller.enqueue(assistantStarted(2, "assistant-1", "Hel"));
    controller.enqueue(assistantDelta(3, "assistant-1", "lo"));
    controller.enqueue(assistantCompleted(4, "assistant-1", "Hello"));

    expect(patchSpy).not.toHaveBeenCalled();
    scheduled.flush();

    expect(patchSpy).toHaveBeenCalledTimes(1);
    const slot = useHarnessStore.getState().sessionSlots["session-1"];
    expect(slot.events.map((event) => event.seq)).toEqual([1, 2, 3, 4]);
    expect(slot.transcript.lastSeq).toBe(4);
  });

  it("applies a contiguous prefix before a gap and reconnects from the new sequence", () => {
    const scheduled = createManualScheduler();
    const patchSpy = spyOnPatchSessionSlot();
    const closeCurrentHandle = vi.fn();
    const scheduleReconnect = vi.fn();
    const controller = createTestController({
      scheduler: scheduled.scheduler,
      closeCurrentHandle,
      scheduleReconnect,
    });

    controller.enqueue(assistantStarted(2, "assistant-1", "Hel"));
    controller.enqueue(turnEnded(4));
    scheduled.flush();

    expect(patchSpy).toHaveBeenCalledTimes(1);
    const slot = useHarnessStore.getState().sessionSlots["session-1"];
    expect(slot.events.map((event) => event.seq)).toEqual([1, 2]);
    expect(slot.transcript.lastSeq).toBe(2);
    expect(slot.streamConnectionState).toBe("disconnected");
    expect(closeCurrentHandle).toHaveBeenCalledTimes(1);
    expect(scheduleReconnect).toHaveBeenCalledWith(0);
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
    useHarnessStore.getState().patchSessionSlot("session-1", {
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
    const patchSpy = spyOnPatchSessionSlot();
    const controller = createTestController();

    controller.enqueue(assistantStarted(2, "assistant-1", "Hello"));
    expect(patchSpy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);

    expect(patchSpy).toHaveBeenCalledTimes(1);
    const slot = useHarnessStore.getState().sessionSlots["session-1"];
    expect(slot.events.map((event) => event.seq)).toEqual([1, 2]);
  });
});

function createTestController(options?: {
  scheduler?: SessionStreamFlushScheduler;
  closeCurrentHandle?: () => void;
  scheduleReconnect?: (delayMs?: number) => void;
  clearActiveSummaryRefreshTimer?: () => void;
  scheduleActiveSummaryRefresh?: () => void;
  refreshSessionSlotMeta?: () => Promise<void>;
}) {
  return createSessionStreamFlushController({
    queryClient: new QueryClient(),
    mountSubagentChildSession: vi.fn(),
    persistReconciledModePreferences: vi.fn(),
    refreshSessionSlotMeta: options?.refreshSessionSlotMeta ?? vi.fn(),
    showToast: vi.fn(),
    scheduler: options?.scheduler,
    sessionId: "session-1",
    streamMeasurementOperationId: null,
    isStillCurrent: () => true,
    isCurrentStream: () => true,
    closeCurrentHandle: options?.closeCurrentHandle ?? vi.fn(),
    scheduleReconnect: options?.scheduleReconnect ?? vi.fn(),
    clearActiveSummaryRefreshTimer: options?.clearActiveSummaryRefreshTimer ?? vi.fn(),
    scheduleActiveSummaryRefresh: options?.scheduleActiveSummaryRefresh ?? vi.fn(),
    scheduleStartupReadyRefresh: vi.fn(),
  });
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

function spyOnPatchSessionSlot() {
  const patchSpy = vi.fn(originalPatchSessionSlot);
  useHarnessStore.setState({
    patchSessionSlot: patchSpy,
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
