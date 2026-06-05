import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  collectInactiveSessionStreamIds,
  detachAndCloseSessionStreams,
  pruneInactiveSessionStreams,
  type FlushAwareSessionStreamHandle,
  type SessionStreamPruningDeps,
} from "./session-runtime";
import {
  fetchSessionHistory,
  resumeSession,
} from "@/lib/access/anyharness/session-runtime";
import {
  assertDirectSessionCreateRuntimeConfigStamped,
  prepareLocalSessionRuntimeConfig,
} from "@/lib/access/anyharness/session-runtime-config";
import type { SessionStreamHandle } from "@anyharness/sdk";
import { ProliferateClientError } from "@proliferate/cloud-sdk/client/core";
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
  applyRuntimeConfig: vi.fn(),
  ensurePersonalSandboxProfile: vi.fn(),
  getSandboxProfileDesktopRuntimeConfigApplyRequest: vi.fn(),
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

vi.mock("@/lib/access/anyharness/runtime-config", () => ({
  applyRuntimeConfig: mocks.applyRuntimeConfig,
}));

vi.mock("@proliferate/cloud-sdk/client/agent-auth", () => ({
  ensurePersonalSandboxProfile: mocks.ensurePersonalSandboxProfile,
}));

vi.mock("@proliferate/cloud-sdk/client/runtime-config", () => ({
  getSandboxProfileDesktopRuntimeConfigApplyRequest:
    mocks.getSandboxProfileDesktopRuntimeConfigApplyRequest,
}));

beforeEach(() => {
  mocks.applyRuntimeConfig.mockReset();
  mocks.ensurePersonalSandboxProfile.mockReset();
  mocks.getSandboxProfileDesktopRuntimeConfigApplyRequest.mockReset();
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

describe("assertDirectSessionCreateRuntimeConfigStamped", () => {
  it("allows local direct session creation", () => {
    expect(() => assertDirectSessionCreateRuntimeConfigStamped({
      anyharnessWorkspaceId: "workspace-1",
      baseUrl: "http://localhost:6174",
      location: "local",
      runtimeGeneration: 0,
    })).not.toThrow();
  });

  it("fails closed for direct remote session creation", () => {
    expect(() => assertDirectSessionCreateRuntimeConfigStamped({
      anyharnessWorkspaceId: "workspace-1",
      baseUrl: "https://runtime.example.test",
      location: "cloud",
      runtimeGeneration: 1,
      authToken: "token",
    })).toThrow(/runtime config stamping/i);
  });
});

describe("prepareLocalSessionRuntimeConfig", () => {
  const connection = {
    runtimeUrl: "http://localhost:6174",
    anyharnessWorkspaceId: "workspace-1",
  };

  it("applies the personal desktop runtime config and returns the applied revision expectation", async () => {
    mocks.ensurePersonalSandboxProfile.mockResolvedValue({
      id: "profile-1",
      primaryTargetId: "target-1",
    });
    mocks.getSandboxProfileDesktopRuntimeConfigApplyRequest.mockResolvedValue({
      applyRequest: {
        source: "desktop",
        revision: {
          id: "revision-1",
          sequence: 2,
          contentHash: "hash-1",
          externalScope: {
            provider: "proliferate-cloud",
            id: "profile-1",
            targetId: "target-1",
          },
        },
        manifest: {},
      },
      expectedRuntimeConfigRevision: {
        revisionId: "revision-1",
        sequence: 2,
        contentHash: "hash-1",
        externalScope: null,
      },
    });
    mocks.applyRuntimeConfig.mockResolvedValue({
      applied: true,
      status: "applied",
      revision: {
        id: "revision-1",
        sequence: 2,
        contentHash: "hash-1",
        externalScope: {
          provider: "proliferate-cloud",
          id: "profile-1",
          targetId: "target-1",
        },
      },
    });

    await expect(prepareLocalSessionRuntimeConfig(connection)).resolves.toEqual({
      revisionId: "revision-1",
      sequence: 2,
      contentHash: "hash-1",
      externalScope: {
        provider: "proliferate-cloud",
        id: "profile-1",
        targetId: "target-1",
      },
    });
    expect(mocks.getSandboxProfileDesktopRuntimeConfigApplyRequest).toHaveBeenCalledWith(
      "profile-1",
      { targetId: "target-1" },
    );
    expect(mocks.applyRuntimeConfig).toHaveBeenCalledWith(
      connection,
      expect.objectContaining({ source: "desktop" }),
      undefined,
    );
  });

  it("keeps local session creation available when Cloud is not configured", async () => {
    mocks.ensurePersonalSandboxProfile.mockRejectedValue(
      new ProliferateClientError(
        "Proliferate Cloud client is not configured.",
        500,
        "cloud_client_unconfigured",
      ),
    );

    await expect(prepareLocalSessionRuntimeConfig(connection)).resolves.toBeNull();
    expect(mocks.applyRuntimeConfig).not.toHaveBeenCalled();
  });

  it("fails fast when Cloud runtime config preflight stalls", async () => {
    vi.useFakeTimers();
    try {
      mocks.ensurePersonalSandboxProfile.mockImplementation(() => new Promise(() => {}));

      const prepared = prepareLocalSessionRuntimeConfig(connection, undefined, {
        cloudPreflightTimeoutMs: 50,
      });
      const expectation = expect(prepared).rejects.toThrow(/timed out/i);

      await vi.advanceTimersByTimeAsync(50);

      await expectation;
      expect(mocks.getSandboxProfileDesktopRuntimeConfigApplyRequest).not.toHaveBeenCalled();
      expect(mocks.applyRuntimeConfig).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("surfaces runtime config materialization failures", async () => {
    mocks.ensurePersonalSandboxProfile.mockResolvedValue({
      id: "profile-1",
      primaryTargetId: "target-1",
    });
    mocks.getSandboxProfileDesktopRuntimeConfigApplyRequest.mockRejectedValue(
      new ProliferateClientError(
        "Runtime config credentials are missing.",
        409,
        "runtime_config_credentials_missing",
      ),
    );

    await expect(prepareLocalSessionRuntimeConfig(connection)).rejects.toMatchObject({
      code: "runtime_config_credentials_missing",
    });
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

    await resumeSession("session-1");

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
