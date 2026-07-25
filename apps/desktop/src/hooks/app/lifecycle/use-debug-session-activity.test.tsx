// @vitest-environment jsdom

import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DesktopDiagnosticsBridge } from "@proliferate/product-client/host/desktop-diagnostics-bridge";

const storeMocks = vi.hoisted(() => ({
  entriesById: {} as Record<string, unknown>,
  listener: null as ((state: { entriesById: Record<string, unknown> }) => void) | null,
  unsubscribe: vi.fn(),
  subscribe: vi.fn(),
}));

vi.mock("@/stores/sessions/session-directory-store", () => {
  const useSessionDirectoryStore = Object.assign(vi.fn(), {
    getState: () => ({ entriesById: storeMocks.entriesById }),
    subscribe: storeMocks.subscribe,
  });
  return { useSessionDirectoryStore };
});
vi.mock("@/lib/domain/sessions/directory/directory-activity", () => ({
  activitySnapshotFromDirectoryEntry: (entry: { snapshot?: unknown } | null) =>
    entry?.snapshot ?? null,
}));
vi.mock("@proliferate/product-domain/sessions/activity", () => ({
  isSessionSlotBusy: (snapshot: { busy?: boolean } | null) =>
    snapshot?.busy === true,
  pendingInteractionsForActivity: (snapshot: { pendingCount?: number }) =>
    Array.from({ length: snapshot.pendingCount ?? 0 }),
  resolveSessionExecutionPhase: (snapshot: { executionPhase?: string } | null) =>
    snapshot?.executionPhase ?? null,
  resolveSessionViewState: (snapshot: { viewState?: string } | null) =>
    snapshot?.viewState ?? "idle",
}));

import { useDebugSessionActivity } from "./use-debug-session-activity";

function makeDiagnostics(enabled: boolean): DesktopDiagnosticsBridge {
  return {
    isSessionActivityDebugEnabled: vi.fn(() => enabled),
    logSessionActivityTransition: vi.fn(),
    forgetSessionActivity: vi.fn(),
    logSessionActivityHoldouts: vi.fn(),
  } as unknown as DesktopDiagnosticsBridge;
}

function busyEntry() {
  return {
    materializedSessionId: "materialized-1",
    workspaceId: "workspace-1",
    snapshot: {
      busy: true,
      viewState: "working",
      executionPhase: "executing",
      executionSummary: { phase: "executing", updatedAt: "2026-07-14T00:00:00Z" },
      status: "running",
      transcript: { isStreaming: true },
      streamConnectionState: "connected",
      pendingCount: 1,
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  storeMocks.entriesById = { "session-1": busyEntry() };
  storeMocks.listener = null;
  storeMocks.unsubscribe.mockReset();
  storeMocks.subscribe.mockReset();
  storeMocks.subscribe.mockImplementation((listener) => {
    storeMocks.listener = listener;
    return storeMocks.unsubscribe;
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("useDebugSessionActivity", () => {
  it("does no product subscription or logging when Desktop disables it", () => {
    const diagnostics = makeDiagnostics(false);

    renderHook(() => useDebugSessionActivity(diagnostics));

    expect(diagnostics.isSessionActivityDebugEnabled).toHaveBeenCalledTimes(1);
    expect(storeMocks.subscribe).not.toHaveBeenCalled();
    expect(diagnostics.logSessionActivityTransition).not.toHaveBeenCalled();
    expect(diagnostics.logSessionActivityHoldouts).not.toHaveBeenCalled();
  });

  it("delegates transitions and holdouts, then cleans its subscription and timer", () => {
    const diagnostics = makeDiagnostics(true);
    const { unmount } = renderHook(() => useDebugSessionActivity(diagnostics));

    expect(storeMocks.subscribe).toHaveBeenCalledTimes(1);
    expect(diagnostics.logSessionActivityTransition).toHaveBeenCalledWith(
      "session-1",
      {
        viewState: "working",
        executionPhase: "executing",
        status: "running",
        transcriptIsStreaming: true,
        streamConnectionState: "connected",
        pendingInteractionCount: 1,
        executionSummaryUpdatedAt: "2026-07-14T00:00:00Z",
      },
    );

    vi.advanceTimersByTime(10_000);
    expect(diagnostics.logSessionActivityHoldouts).toHaveBeenCalledTimes(1);
    expect(diagnostics.logSessionActivityHoldouts).toHaveBeenCalledWith([
      expect.objectContaining({
        sessionId: "session-1",
        materializedSessionId: "materialized-1",
        workspaceId: "workspace-1",
        viewState: "working",
      }),
    ]);

    storeMocks.entriesById = {};
    storeMocks.listener?.({ entriesById: {} });
    expect(diagnostics.forgetSessionActivity).toHaveBeenCalledWith("session-1");

    const holdoutCallsBeforeUnmount = vi.mocked(
      diagnostics.logSessionActivityHoldouts,
    ).mock.calls.length;
    unmount();
    expect(storeMocks.unsubscribe).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(20_000);
    expect(diagnostics.logSessionActivityHoldouts).toHaveBeenCalledTimes(
      holdoutCallsBeforeUnmount,
    );
  });
});
