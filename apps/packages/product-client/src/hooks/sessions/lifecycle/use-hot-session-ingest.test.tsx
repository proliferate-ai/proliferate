// @vitest-environment jsdom

import type { SessionEventEnvelope } from "@anyharness/sdk";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionStreamCache } from "#product/hooks/sessions/cache/use-session-stream-cache";
import { useHotSessionIngest } from "#product/hooks/sessions/lifecycle/use-hot-session-ingest";
import {
  createSessionStreamFlushController,
  type SessionStreamFlushScheduler,
} from "#product/hooks/sessions/lifecycle/use-session-stream-flush";
import { resetStreamWorkspaceActivityForTests } from "#product/hooks/sessions/lifecycle/session-stream-side-effects";
import { closeSessionSlotStream } from "#product/hooks/sessions/lifecycle/session-stream-slot-connection";
import { useWorkspaceSidebarActivityStates } from "#product/hooks/workspaces/derived/use-workspace-sidebar-activities";
import { replaySessionHistory } from "#product/lib/domain/sessions/stream/stream-state";
import { resetHotSessionIngestManagerForTest } from "#product/lib/workflows/sessions/hot-session-ingest-manager";
import { useWorkspaceUiStore } from "#product/stores/preferences/workspace-ui-store";
import { useSessionDirectoryStore } from "#product/stores/sessions/session-directory-store";
import { useSessionIngestStore } from "#product/stores/sessions/session-ingest-store";
import { useSessionIntentStore } from "#product/stores/sessions/session-intent-store";
import {
  createEmptySessionRecord,
  getSessionRecord,
  putSessionRecord,
} from "#product/stores/sessions/session-records";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import { useSessionTranscriptStore } from "#product/stores/sessions/session-transcript-store";

const runtimeActions = vi.hoisted(() => ({
  closeSessionSlotStream: vi.fn(),
  ensureSessionStreamConnected: vi.fn(),
}));

vi.mock("#product/hooks/sessions/workflows/use-session-runtime-actions", () => ({
  useSessionRuntimeActions: () => runtimeActions,
}));

describe("useHotSessionIngest", () => {
  beforeEach(() => {
    resetHotSessionIngestManagerForTest();
    resetStreamWorkspaceActivityForTests();
    useSessionDirectoryStore.getState().clearEntries();
    useSessionTranscriptStore.getState().clearEntries();
    useSessionIntentStore.getState().clear();
    useSessionSelectionStore.getState().clearSelection();
    useWorkspaceUiStore.setState({ visibleChatSessionIdsByWorkspace: {} });
    runtimeActions.closeSessionSlotStream.mockReset();
    runtimeActions.closeSessionSlotStream.mockImplementation(closeSessionSlotStream);
    runtimeActions.ensureSessionStreamConnected.mockReset();
    // The SSE connector is the only stateful boundary replaced here. Session
    // policy, reconciliation, teardown state, stream reduction, and sidebar
    // projection all use their production implementations.
    runtimeActions.ensureSessionStreamConnected.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    resetHotSessionIngestManagerForTest();
    resetStreamWorkspaceActivityForTests();
    useSessionIntentStore.getState().clear();
    vi.clearAllMocks();
  });

  it("keeps background activity connected through navigation until a real completion event", async () => {
    putSession({
      sessionId: "background-session",
      workspaceId: "background-workspace",
      streaming: true,
    });
    putSession({
      sessionId: "selected-session",
      workspaceId: "selected-workspace",
      streaming: false,
    });
    useSessionSelectionStore.getState().activateWorkspace({
      logicalWorkspaceId: "background-logical-workspace",
      workspaceId: "background-workspace",
      initialActiveSessionId: "background-session",
    });

    const { result } = renderHook(() => {
      useHotSessionIngest();
      return useWorkspaceSidebarActivityStates();
    });

    await waitFor(() => {
      expect(currentTargetReasons()).toEqual([
        ["background-session", "selected"],
      ]);
      expect(result.current["background-workspace"]).toBe("iterating");
    });

    act(() => {
      useSessionSelectionStore.getState().activateWorkspace({
        logicalWorkspaceId: "selected-logical-workspace",
        workspaceId: "selected-workspace",
        initialActiveSessionId: "selected-session",
      });
    });

    await waitFor(() => {
      expect(currentTargetReasons()).toEqual([
        ["selected-session", "selected"],
        ["background-session", "running"],
      ]);
      expect(result.current["background-workspace"]).toBe("iterating");
    });
    expect(runtimeActions.closeSessionSlotStream).not.toHaveBeenCalledWith(
      "background-session",
    );

    act(() => {
      useSessionSelectionStore.getState().deselectWorkspacePreservingSessions();
    });

    await waitFor(() => {
      expect(currentTargetReasons()).toEqual([
        ["background-session", "running"],
      ]);
      expect(result.current["background-workspace"]).toBe("iterating");
    });
    expect(runtimeActions.closeSessionSlotStream).not.toHaveBeenCalledWith(
      "background-session",
    );

    const completion = createCompletionController("background-session");
    act(() => {
      completion.controller.enqueue(turnEnded("background-session", 2));
      completion.scheduler.flush();
    });

    await waitFor(() => {
      expect(currentTargetReasons()).toEqual([]);
      expect(result.current["background-workspace"]).toBe("idle");
      expect(runtimeActions.closeSessionSlotStream).toHaveBeenCalledWith(
        "background-session",
      );
    });
    expect(getSessionRecord("background-session")).toMatchObject({
      status: "idle",
      executionSummary: { phase: "idle" },
      streamConnectionState: "disconnected",
      transcript: { isStreaming: false, lastSeq: 2 },
    });
    completion.controller.dispose();
  });
});

function putSession({
  sessionId,
  workspaceId,
  streaming,
}: {
  sessionId: string;
  workspaceId: string;
  streaming: boolean;
}): void {
  const state = replaySessionHistory(
    sessionId,
    streaming ? [turnStarted(sessionId, 1)] : [],
  );
  putSessionRecord({
    ...createEmptySessionRecord(sessionId, "codex", { workspaceId }),
    events: state.events,
    transcript: state.transcript,
    transcriptHydrated: true,
    streamConnectionState: streaming ? "open" : "disconnected",
    status: "idle",
  });
  useSessionDirectoryStore.getState().patchActivityFromTranscript(
    sessionId,
    state.transcript,
  );
}

function currentTargetReasons(): string[][] {
  return Object.values(useSessionIngestStore.getState().targetsByClientSessionId)
    .sort((left, right) =>
      left.priority - right.priority
      || left.clientSessionId.localeCompare(right.clientSessionId)
    )
    .map((target) => [target.clientSessionId, target.reason]);
}

function createCompletionController(sessionId: string) {
  const scheduler = createManualScheduler();
  return {
    controller: createSessionStreamFlushController({
      sessionStreamCache: createTestSessionStreamCache(),
      mountSubagentChildSession: vi.fn(),
      persistReconciledControlPreferences: vi.fn(),
      refreshSessionSlotMeta: vi.fn(),
      rehydrateSessionSlotFromHistory: vi.fn().mockResolvedValue(false),
      showToast: vi.fn(),
      scheduler: scheduler.scheduler,
      sessionId,
      streamMeasurementOperationId: null,
      isStillCurrent: () => true,
      isCurrentStream: () => true,
      closeCurrentHandle: vi.fn(),
      scheduleReconnect: vi.fn(),
      clearActiveSummaryRefreshTimer: vi.fn(),
      scheduleActiveSummaryRefresh: vi.fn(),
      scheduleStartupReadyRefresh: vi.fn(),
    }),
    scheduler,
  };
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

function turnStarted(sessionId: string, seq: number): SessionEventEnvelope {
  return {
    sessionId,
    seq,
    timestamp: `2026-08-10T00:00:0${seq}Z`,
    turnId: "turn-1",
    event: { type: "turn_started" },
  };
}

function turnEnded(sessionId: string, seq: number): SessionEventEnvelope {
  return {
    sessionId,
    seq,
    timestamp: `2026-08-10T00:00:0${seq}Z`,
    turnId: "turn-1",
    event: { type: "turn_ended", stopReason: "end_turn" },
  };
}
