import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  reconcileHotSessions,
  resetHotSessionIngestManagerForTest,
  type HotSessionIngestManagerDeps,
} from "@/lib/workflows/sessions/hot-session-ingest-manager";
import {
  useSessionIngestStore,
} from "@/stores/sessions/session-ingest-store";
import {
  createEmptySessionRecord,
  patchSessionRecord,
  putSessionRecord,
} from "@/stores/sessions/session-records";
import { useSessionDirectoryStore } from "@/stores/sessions/session-directory-store";
import { useSessionTranscriptStore } from "@/stores/sessions/session-transcript-store";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import type { HotSessionTarget } from "@/lib/domain/sessions/hot-session-policy";

describe("hot-session-ingest-manager", () => {
  beforeEach(() => {
    vi.useRealTimers();
    resetHotSessionIngestManagerForTest();
    useSessionSelectionStore.setState({
      activeSessionId: "session-a",
      selectedWorkspaceId: "workspace-1",
    });
    useSessionDirectoryStore.getState().clearEntries();
    useSessionTranscriptStore.getState().clearEntries();
  });

  it("opens a stream for a visible unselected hot target", async () => {
    putSessionRecord(createEmptySessionRecord("session-b", "codex", {
      workspaceId: "workspace-1",
    }));
    const deps = depsWithEnsure(async () => {
      patchSessionRecord("session-b", { streamConnectionState: "open" });
    });

    reconcileHotSessions([target("session-b", "open_tab")], deps);
    await Promise.resolve();

    expect(deps.ensureSessionStreamConnected).toHaveBeenCalledWith(
      "session-b",
      expect.objectContaining({
        awaitOpen: true,
        hydrateBeforeStream: false,
        skipInitialRefresh: true,
      }),
    );
    const options = vi.mocked(deps.ensureSessionStreamConnected).mock.calls[0]?.[1];
    useSessionSelectionStore.setState({ activeSessionId: "session-a" });
    expect(options?.isCurrent?.()).toBe(true);
    expect(useSessionIngestStore.getState().freshnessByClientSessionId["session-b"]?.freshness)
      .toBe("current");
  });

  it("closes and marks cold when a target is demoted", () => {
    putSessionRecord(createEmptySessionRecord("session-b", "codex", {
      workspaceId: "workspace-1",
    }));
    const deps = depsWithEnsure(async () => {});

    reconcileHotSessions([target("session-b", "open_tab")], deps);
    reconcileHotSessions([], deps);

    expect(deps.closeSessionSlotStream).toHaveBeenCalledWith("session-b");
    expect(useSessionIngestStore.getState().freshnessByClientSessionId["session-b"]?.freshness)
      .toBe("cold");
  });

  it("blocks stale stream callbacks after the hot generation changes", async () => {
    putSessionRecord(createEmptySessionRecord("session-b", "codex", {
      workspaceId: "workspace-1",
    }));
    const deps = depsWithEnsure(async () => {});

    reconcileHotSessions([target("session-b", "open_tab")], deps);
    const options = vi.mocked(deps.ensureSessionStreamConnected).mock.calls[0]?.[1];
    expect(options?.isCurrent?.()).toBe(true);

    reconcileHotSessions([], deps);

    expect(options?.isCurrent?.()).toBe(false);
  });

  it("routes hot stream reconnects through bounded manager backoff", async () => {
    vi.useFakeTimers();
    putSessionRecord(createEmptySessionRecord("session-b", "codex", {
      workspaceId: "workspace-1",
    }));
    const deps = depsWithEnsure(async (_sessionId, options) => {
      patchSessionRecord("session-b", { streamConnectionState: "disconnected" });
      useSessionIngestStore.getState().markStale("session-b");
      options?.onReconnectNeeded?.();
    });

    reconcileHotSessions([target("session-b", "open_tab")], deps);
    await Promise.resolve();

    expect(deps.ensureSessionStreamConnected).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(499);
    expect(deps.ensureSessionStreamConnected).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(deps.ensureSessionStreamConnected).toHaveBeenCalledTimes(2);
  });

  it("waits for projected targets to materialize before opening streams", () => {
    putSessionRecord(createEmptySessionRecord("client-session:codex:1", "codex", {
      materializedSessionId: null,
      workspaceId: "workspace-1",
    }));
    const deps = depsWithEnsure(async () => {});

    reconcileHotSessions([
      {
        ...target("client-session:codex:1", "selected"),
        materializedSessionId: null,
        streamable: false,
      },
    ], deps);

    expect(deps.ensureSessionStreamConnected).not.toHaveBeenCalled();
    expect(
      useSessionIngestStore.getState()
        .freshnessByClientSessionId["client-session:codex:1"]?.freshness,
    ).toBe("warming");
  });
});

function target(
  clientSessionId: string,
  reason: HotSessionTarget["reason"],
): HotSessionTarget {
  return {
    clientSessionId,
    materializedSessionId: clientSessionId,
    priority: reason === "selected" ? 0 : 4,
    reason,
    streamable: true,
    workspaceId: "workspace-1",
  };
}

function depsWithEnsure(
  ensure: HotSessionIngestManagerDeps["ensureSessionStreamConnected"],
): HotSessionIngestManagerDeps {
  return {
    closeSessionSlotStream: vi.fn(),
    ensureSessionStreamConnected: vi.fn(ensure),
  };
}
