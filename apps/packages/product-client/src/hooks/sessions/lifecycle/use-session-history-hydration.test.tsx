// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionEventEnvelope } from "@anyharness/sdk";
import { replaySessionHistory } from "#product/lib/domain/sessions/stream/stream-state";
import { useSessionHistoryHydration } from "#product/hooks/sessions/lifecycle/use-session-history-hydration";
import {
  resetSessionHistoryHydrationInFlightForTest,
} from "#product/hooks/sessions/lifecycle/session-history-hydration-dedupe";
import {
  createEmptySessionRecord,
  getSessionRecord,
  putSessionRecord,
} from "#product/stores/sessions/session-records";
import { useSessionDirectoryStore } from "#product/stores/sessions/session-directory-store";
import { useSessionIntentStore } from "#product/stores/sessions/session-intent-store";
import { useSessionTranscriptStore } from "#product/stores/sessions/session-transcript-store";

const mocks = vi.hoisted(() => ({
  fetchSessionHistory: vi.fn(),
  reconcileHydratedSubagents: vi.fn(),
  reconcileWorkspacePinIntents: vi.fn(),
}));

vi.mock("@proliferate/product-client/host/ProductHostProvider", () => ({
  useProductHost: () => ({ cloud: { client: null }, desktop: null }),
}));

vi.mock("#product/lib/access/anyharness/session-runtime", async (importOriginal) => ({
  ...await importOriginal<
    typeof import("#product/lib/access/anyharness/session-runtime")
  >(),
  fetchSessionHistory: mocks.fetchSessionHistory,
}));

vi.mock("#product/hooks/sessions/lifecycle/use-session-history-subagent-authority", () => ({
  useSessionHistorySubagentAuthority: () => mocks.reconcileHydratedSubagents,
}));

vi.mock("#product/hooks/sessions/lifecycle/use-workspace-pin-intent-reconciliation", () => ({
  useWorkspacePinIntentReconciliation: () => mocks.reconcileWorkspacePinIntents,
}));

beforeEach(() => {
  vi.clearAllMocks();
  resetSessionHistoryHydrationInFlightForTest();
  useSessionDirectoryStore.getState().clearEntries();
  useSessionIntentStore.getState().clear();
  useSessionTranscriptStore.getState().clearEntries();
});

afterEach(() => {
  cleanup();
  useSessionDirectoryStore.getState().clearEntries();
  useSessionIntentStore.getState().clear();
  useSessionTranscriptStore.getState().clearEntries();
});

describe("useSessionHistoryHydration subagent authority", () => {
  it("retries authority when a stale first apply makes the next tail a no-op", async () => {
    const first = turnStarted(1);
    const duplicateTail = turnEnded(2);
    const initial = replaySessionHistory("session-1", [first]);
    putSessionRecord({
      ...createEmptySessionRecord("session-1", "codex", {
        workspaceId: "workspace-1",
      }),
      events: initial.events,
      transcript: initial.transcript,
    });
    mocks.fetchSessionHistory.mockResolvedValue([duplicateTail]);
    let current = true;
    mocks.reconcileHydratedSubagents
      .mockImplementationOnce(async () => {
        current = false;
        return false;
      })
      .mockResolvedValueOnce(true);
    const rendered = renderHook(() => useSessionHistoryHydration());

    let firstResult = true;
    await act(async () => {
      firstResult = await rendered.result.current.rehydrateSessionSlotFromHistory(
        "session-1",
        { afterSeq: 1, isCurrent: () => current },
      );
    });
    expect(firstResult).toBe(false);
    expect(getSessionRecord("session-1")?.transcript.lastSeq).toBe(2);

    current = true;
    let retryResult = false;
    await act(async () => {
      retryResult = await rendered.result.current.rehydrateSessionSlotFromHistory(
        "session-1",
        { afterSeq: 1, isCurrent: () => current },
      );
    });

    expect(retryResult).toBe(true);
    expect(mocks.reconcileHydratedSubagents).toHaveBeenCalledTimes(2);
    expect(mocks.reconcileHydratedSubagents.mock.calls[1]?.[0].transcript.lastSeq).toBe(2);
  });
});

describe("useSessionHistoryHydration session-open dedupe", () => {
  it("collapses two concurrent full hydrations of a session into one fetch", async () => {
    putSessionRecord(createEmptySessionRecord("session-1", "codex", {
      workspaceId: "workspace-1",
    }));
    let resolveFetch!: (events: SessionEventEnvelope[]) => void;
    mocks.fetchSessionHistory.mockReturnValueOnce(
      new Promise<SessionEventEnvelope[]>((resolve) => {
        resolveFetch = resolve;
      }),
    );
    mocks.reconcileHydratedSubagents.mockResolvedValue(true);
    const rendered = renderHook(() => useSessionHistoryHydration());

    let results: [boolean, boolean] = [false, false];
    await act(async () => {
      // Bootstrap kickoff and the transcript pane both hydrate the same session
      // while the first fetch is still in flight.
      const first = rendered.result.current.rehydrateSessionSlotFromHistory(
        "session-1",
        { replace: true },
      );
      const second = rendered.result.current.rehydrateSessionSlotFromHistory(
        "session-1",
        { replace: true },
      );
      resolveFetch([turnStarted(1), turnEnded(2)]);
      results = await Promise.all([first, second]);
    });

    expect(mocks.fetchSessionHistory).toHaveBeenCalledTimes(1);
    expect(results).toEqual([true, true]);
  });

  it("does not dedupe incremental (afterSeq/beforeSeq) fetches", async () => {
    const initial = replaySessionHistory("session-1", [turnStarted(1)]);
    putSessionRecord({
      ...createEmptySessionRecord("session-1", "codex", { workspaceId: "workspace-1" }),
      events: initial.events,
      transcript: initial.transcript,
    });
    mocks.fetchSessionHistory.mockResolvedValue([turnEnded(2)]);
    mocks.reconcileHydratedSubagents.mockResolvedValue(true);
    const rendered = renderHook(() => useSessionHistoryHydration());

    await act(async () => {
      await rendered.result.current.rehydrateSessionSlotFromHistory("session-1", { afterSeq: 1 });
      await rendered.result.current.rehydrateSessionSlotFromHistory("session-1", { afterSeq: 1 });
    });

    expect(mocks.fetchSessionHistory).toHaveBeenCalledTimes(2);
  });
});

function turnStarted(seq: number): SessionEventEnvelope {
  return {
    sessionId: "session-1",
    seq,
    timestamp: "2026-04-04T00:00:01Z",
    turnId: "turn-1",
    event: { type: "turn_started" },
  };
}

function turnEnded(seq: number): SessionEventEnvelope {
  return {
    sessionId: "session-1",
    seq,
    timestamp: "2026-04-04T00:00:02Z",
    turnId: "turn-1",
    event: { type: "turn_ended", stopReason: "end_turn" },
  };
}
