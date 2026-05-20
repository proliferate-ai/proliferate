import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  collectInactiveSessionStreamIds,
  detachAndCloseSessionStreams,
  fetchSessionHistory,
  pruneInactiveSessionStreams,
  resumeSession,
  type FlushAwareSessionStreamHandle,
  type SessionStreamPruningDeps,
} from "./session-runtime";
import type { SessionStreamHandle } from "@anyharness/sdk";
import {
  createEmptySessionRecord,
  findClientSessionIdByMaterializedSessionId,
  getMaterializedSessionId,
  getSessionRecord,
  getSessionRecords,
  isPendingSessionId,
  patchSessionRecord,
  putSessionRecord,
} from "@/stores/sessions/session-records";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";
import { useSessionDirectoryStore } from "@/stores/sessions/session-directory-store";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useSessionTranscriptStore } from "@/stores/sessions/session-transcript-store";
import {
  closeSessionStreamHandle,
  flushAllSessionStreamHandles,
  getSessionStreamHandle,
  setSessionStreamHandle,
  resetSessionStreamHandlesForTest,
} from "@/lib/access/anyharness/session-stream-handles";

const sessionStreamPruningDeps: SessionStreamPruningDeps = {
  getSessionRecords,
  getSessionStreamHandle: (sessionId: string) =>
    getSessionStreamHandle(sessionId) as FlushAwareSessionStreamHandle | null,
  closeSessionStreamHandle: (
    sessionId: string,
    handle: FlushAwareSessionStreamHandle,
  ) => {
    closeSessionStreamHandle(sessionId, handle);
  },
  flushAllSessionStreamHandles,
  getMaterializedSessionId,
  findClientSessionIdByMaterializedSessionId,
  patchSessionStreamConnectionState: (
    clientSessionId: string,
    streamConnectionState,
  ) => {
    patchSessionRecord(clientSessionId, { streamConnectionState });
  },
  isPendingSessionId,
};

const mocks = vi.hoisted(() => ({
  listEvents: vi.fn(),
  resume: vi.fn(),
  resolveRuntimeTargetForWorkspace: vi.fn(),
}));

vi.mock("@anyharness/sdk-react", () => ({
  getAnyHarnessClient: () => ({
    sessions: {
      listEvents: mocks.listEvents,
      resume: mocks.resume,
    },
  }),
}));

vi.mock("@/lib/access/anyharness/runtime-target", () => ({
  resolveRuntimeTargetForWorkspace: mocks.resolveRuntimeTargetForWorkspace,
}));

beforeEach(() => {
  mocks.listEvents.mockReset();
  mocks.resume.mockReset();
  mocks.resolveRuntimeTargetForWorkspace.mockReset();
  resetSessionStreamHandlesForTest();
  useHarnessConnectionStore.setState({
    runtimeUrl: "http://localhost:5173",
    connectionState: "healthy",
    error: null,
  });
  useSessionSelectionStore.setState({
    selectedWorkspaceId: "workspace-1",
    activeSessionId: null,
  });
  useSessionDirectoryStore.getState().clearEntries();
  useSessionTranscriptStore.getState().clearEntries();
  putSessionRecord(createEmptySessionRecord("session-1", "codex", {
    workspaceId: "workspace-1",
  }));
});

describe("fetchSessionHistory", () => {
  it("times out while resolving the runtime target", async () => {
    vi.useFakeTimers();
    try {
      mocks.resolveRuntimeTargetForWorkspace.mockImplementation(() => new Promise(() => {}));

      const history = fetchSessionHistory("session-1", { timeoutMs: 50 });
      const historyExpectation = expect(history).rejects.toMatchObject({ name: "AbortError" });
      await vi.advanceTimersByTimeAsync(50);

      await historyExpectation;
      expect(mocks.listEvents).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("aborts event listing when the history timeout elapses", async () => {
    vi.useFakeTimers();
    try {
      mocks.resolveRuntimeTargetForWorkspace.mockResolvedValue({
        anyharnessWorkspaceId: "runtime-workspace-1",
        baseUrl: "http://runtime.local",
        location: "local",
        runtimeGeneration: 0,
      });
      let signal: AbortSignal | undefined;
      mocks.listEvents.mockImplementation((
        _sessionId: string,
        options?: { request?: { signal?: AbortSignal } },
      ) => {
        signal = options?.request?.signal;
        return new Promise(() => {});
      });

      const history = fetchSessionHistory("session-1", { timeoutMs: 50 });
      const historyExpectation = expect(history).rejects.toMatchObject({ name: "AbortError" });
      await vi.advanceTimersByTimeAsync(0);

      expect(signal).toBeDefined();
      expect(signal?.aborted).toBe(false);

      await vi.advanceTimersByTimeAsync(50);

      await historyExpectation;
      expect(signal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("collectInactiveSessionStreamIds", () => {
  it("prunes only idle, non-pending sessions with open stream handles", () => {
    const idleSlot = {
      ...createEmptySessionRecord("session-idle", "codex"),
      streamConnectionState: "open" as const,
      transcriptHydrated: true,
      status: "idle" as const,
    };
    const workingSlot = {
      ...createEmptySessionRecord("session-working", "codex"),
      streamConnectionState: "open" as const,
      transcriptHydrated: true,
      status: "running" as const,
    };
    const pendingSlot = {
      ...createEmptySessionRecord("pending-session:codex:1:abc123", "codex"),
      streamConnectionState: "open" as const,
      transcriptHydrated: true,
      status: "idle" as const,
    };
    for (const sessionId of [
      "session-idle",
      "session-working",
      "pending-session:codex:1:abc123",
    ]) {
      setSessionStreamHandle({
        sessionId,
        workspaceId: "workspace-1",
        runtimeUrl: "http://localhost:5173",
        handle: { close() {} },
      });
    }

    const prunableSessionIds = collectInactiveSessionStreamIds({
      "session-idle": idleSlot,
      "session-working": workingSlot,
      "pending-session:codex:1:abc123": pendingSlot,
    }, sessionStreamPruningDeps, {
      preserveSessionIds: ["session-working"],
    });

    expect(prunableSessionIds).toEqual(["session-idle"]);
  });
});

describe("detachAndCloseSessionStreams", () => {
  it("closes the current handle before detaching it from the store", () => {
    let handle: SessionStreamHandle;
    const close = vi.fn(() => {
      expect(getSessionStreamHandle("session-1")).toBe(handle);
      patchSessionRecord("session-1", {
        title: "flushed title",
      });
    });
    handle = { close };
    setSessionStreamHandle({
      sessionId: "session-1",
      workspaceId: "workspace-1",
      runtimeUrl: "http://localhost:5173",
      handle,
    });
    patchSessionRecord("session-1", {
      streamConnectionState: "open",
      title: "initial title",
    });

    expect(detachAndCloseSessionStreams(["session-1"], sessionStreamPruningDeps)).toBe(1);

    const slot = getSessionRecord("session-1")!;
    expect(close).toHaveBeenCalledTimes(1);
    expect(getSessionStreamHandle("session-1")).toBeNull();
    expect(slot.streamConnectionState).toBe("disconnected");
    expect(slot.title).toBe("flushed title");
  });
});

describe("pruneInactiveSessionStreams", () => {
  it("flushes pending stream events before deciding whether an idle stream is prunable", () => {
    const close = vi.fn();
    const flushPendingEvents = vi.fn(() => {
      patchSessionRecord("session-1", {
        status: "running",
      });
    });
    const handle = {
      close,
      flushPendingEvents,
    } as SessionStreamHandle & { flushPendingEvents: () => void };
    setSessionStreamHandle({
      sessionId: "session-1",
      workspaceId: "workspace-1",
      runtimeUrl: "http://localhost:5173",
      handle,
    });
    patchSessionRecord("session-1", {
      streamConnectionState: "open",
      transcriptHydrated: true,
      status: "idle",
    });

    expect(pruneInactiveSessionStreams(sessionStreamPruningDeps)).toEqual([]);

    const slot = getSessionRecord("session-1")!;
    expect(flushPendingEvents).toHaveBeenCalledTimes(1);
    expect(close).not.toHaveBeenCalled();
    expect(getSessionStreamHandle("session-1")).toBe(handle);
    expect(slot.status).toBe("running");
  });
});

describe("resumeSession", () => {
  it("resumes without per-session MCP or plugin payloads", async () => {
    mocks.resolveRuntimeTargetForWorkspace.mockResolvedValue({
      anyharnessWorkspaceId: "runtime-workspace-1",
      baseUrl: "http://runtime.local",
      location: "local",
      runtimeGeneration: 0,
    });
    mocks.resume.mockResolvedValue({ id: "session-1" });

    await resumeSession("session-1", {
      pluginsInCodingSessionsEnabled: false,
    });

    expect(mocks.resume).toHaveBeenCalledTimes(1);
    const [sessionId, resumeOptions, requestOptions] = mocks.resume.mock.calls[0]!;
    expect(sessionId).toBe("session-1");
    expect(resumeOptions).toBeUndefined();
    if (requestOptions !== undefined) {
      expect(requestOptions).toMatchObject({
        timingCategory: "session.resume",
      });
    }
  });
});
