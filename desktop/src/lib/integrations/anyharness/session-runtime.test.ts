import { beforeEach, describe, expect, it, vi } from "vitest";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import {
  collectInactiveSessionStreamIds,
  createEmptySessionSlot,
  createSessionSlotFromSummary,
  detachAndCloseSessionSlotStreams,
  fetchSessionHistory,
  pruneInactiveSessionStreams,
  resumeSession,
} from "./session-runtime";
import type { Session, SessionStreamHandle } from "@anyharness/sdk";

const mocks = vi.hoisted(() => ({
  listEvents: vi.fn(),
  resume: vi.fn(),
  resolveRuntimeTargetForWorkspace: vi.fn(),
  resolveSessionMcpServersForLaunch: vi.fn(),
  workspacesGet: vi.fn(),
}));

vi.mock("@anyharness/sdk-react", () => ({
  getAnyHarnessClient: () => ({
    sessions: {
      listEvents: mocks.listEvents,
      resume: mocks.resume,
    },
    workspaces: {
      get: mocks.workspacesGet,
    },
  }),
}));

vi.mock("@/lib/integrations/anyharness/runtime-target", () => ({
  resolveRuntimeTargetForWorkspace: mocks.resolveRuntimeTargetForWorkspace,
}));

vi.mock("@/lib/integrations/anyharness/mcp_launch", () => ({
  resolveSessionMcpServersForLaunch: mocks.resolveSessionMcpServersForLaunch,
}));

beforeEach(() => {
  mocks.listEvents.mockReset();
  mocks.resume.mockReset();
  mocks.resolveRuntimeTargetForWorkspace.mockReset();
  mocks.resolveSessionMcpServersForLaunch.mockReset();
  mocks.workspacesGet.mockReset();
  useHarnessStore.setState({
    runtimeUrl: "http://localhost:5173",
    selectedWorkspaceId: "workspace-1",
    sessionSlots: {
      "session-1": createEmptySessionSlot("session-1", "codex", {
        workspaceId: "workspace-1",
      }),
    },
  });
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
  it("initializes empty pending config changes on new slots", () => {
    expect(createEmptySessionSlot("session-1", "codex").pendingConfigChanges).toEqual({});
  });

  it("prunes only idle, non-pending sessions with open stream handles", () => {
    const idleSlot = {
      ...createEmptySessionSlot("session-idle", "codex"),
      streamConnectionState: "open" as const,
      sseHandle: { close() {} },
      transcriptHydrated: true,
      status: "idle" as const,
    };
    const workingSlot = {
      ...createEmptySessionSlot("session-working", "codex"),
      streamConnectionState: "open" as const,
      sseHandle: { close() {} },
      transcriptHydrated: true,
      status: "running" as const,
    };
    const pendingSlot = {
      ...createEmptySessionSlot("pending-session:codex:1:abc123", "codex"),
      streamConnectionState: "open" as const,
      sseHandle: { close() {} },
      transcriptHydrated: true,
      status: "idle" as const,
    };

    const prunableSessionIds = collectInactiveSessionStreamIds({
      "session-idle": idleSlot,
      "session-working": workingSlot,
      "pending-session:codex:1:abc123": pendingSlot,
    }, {
      preserveSessionIds: ["session-working"],
    });

    expect(prunableSessionIds).toEqual(["session-idle"]);
  });
});

describe("detachAndCloseSessionSlotStreams", () => {
  it("closes the current handle before detaching it from the store", () => {
    let handle: SessionStreamHandle;
    const close = vi.fn(() => {
      expect(useHarnessStore.getState().sessionSlots["session-1"].sseHandle).toBe(handle);
      useHarnessStore.getState().patchSessionSlot("session-1", {
        title: "flushed title",
      });
    });
    handle = { close };
    useHarnessStore.getState().patchSessionSlot("session-1", {
      streamConnectionState: "open",
      sseHandle: handle,
      title: "initial title",
    });

    expect(detachAndCloseSessionSlotStreams(["session-1"])).toBe(1);

    const slot = useHarnessStore.getState().sessionSlots["session-1"];
    expect(close).toHaveBeenCalledTimes(1);
    expect(slot.sseHandle).toBeNull();
    expect(slot.streamConnectionState).toBe("disconnected");
    expect(slot.title).toBe("flushed title");
  });
});

describe("pruneInactiveSessionStreams", () => {
  it("flushes pending stream events before deciding whether an idle stream is prunable", () => {
    const close = vi.fn();
    const flushPendingEvents = vi.fn(() => {
      useHarnessStore.getState().patchSessionSlot("session-1", {
        status: "running",
      });
    });
    const handle = {
      close,
      flushPendingEvents,
    } as SessionStreamHandle & { flushPendingEvents: () => void };
    useHarnessStore.getState().patchSessionSlot("session-1", {
      streamConnectionState: "open",
      sseHandle: handle,
      transcriptHydrated: true,
      status: "idle",
    });

    expect(pruneInactiveSessionStreams()).toEqual([]);

    const slot = useHarnessStore.getState().sessionSlots["session-1"];
    expect(flushPendingEvents).toHaveBeenCalledTimes(1);
    expect(close).not.toHaveBeenCalled();
    expect(slot.sseHandle).toBe(handle);
    expect(slot.status).toBe("running");
  });
});

describe("createSessionSlotFromSummary", () => {
  it("uses the subagent label as a fallback title for untitled runtime-created sessions", () => {
    const session = {
      id: "child-session",
      agentKind: "claude",
      modelId: "opus",
      modeId: "default",
      title: null,
      status: "idle",
      liveConfig: null,
      executionSummary: null,
      mcpBindingSummaries: null,
      lastPromptAt: null,
    } as Session;

    const slot = createSessionSlotFromSummary(session, "workspace-1", {
      titleFallback: "haiku-test",
    });

    expect(slot.sessionId).toBe("child-session");
    expect(slot.workspaceId).toBe("workspace-1");
    expect(slot.title).toBe("haiku-test");
    expect(slot.transcript.sessionMeta.title).toBe("haiku-test");
    expect(slot.transcriptHydrated).toBe(false);
    expect(slot.status).toBe("idle");
  });
});

describe("resumeSession", () => {
  it("sends explicit empty MCP bindings without empty summaries when none are launchable", async () => {
    mocks.resolveRuntimeTargetForWorkspace.mockResolvedValue({
      anyharnessWorkspaceId: "runtime-workspace-1",
      baseUrl: "http://runtime.local",
      location: "local",
      runtimeGeneration: 0,
    });
    mocks.workspacesGet.mockResolvedValue({
      path: "/repo",
      surface: "coding",
    });
    mocks.resolveSessionMcpServersForLaunch.mockResolvedValue({
      mcpBindingSummaries: [],
      mcpServers: [],
      warnings: [],
    });
    mocks.resume.mockResolvedValue({ id: "session-1" });

    await resumeSession("session-1", {
      pluginsInCodingSessionsEnabled: false,
    });

    expect(mocks.resolveSessionMcpServersForLaunch).not.toHaveBeenCalled();
    expect(mocks.resume).toHaveBeenCalledWith(
      "session-1",
      {
        mcpBindingSummaries: undefined,
        mcpServers: [],
      },
      undefined,
    );
  });

  it("does not force user Plugins on when resuming cowork sessions", async () => {
    mocks.resolveRuntimeTargetForWorkspace.mockResolvedValue({
      anyharnessWorkspaceId: "runtime-workspace-1",
      baseUrl: "http://runtime.local",
      location: "local",
      runtimeGeneration: 0,
    });
    mocks.workspacesGet.mockResolvedValue({
      path: "/cowork/thread-1",
      surface: "cowork",
    });
    mocks.resolveSessionMcpServersForLaunch.mockResolvedValue({
      mcpBindingSummaries: [],
      mcpServers: [],
      warnings: [],
    });
    mocks.resume.mockResolvedValue({ id: "session-1" });

    await resumeSession("session-1", {
      pluginsInCodingSessionsEnabled: false,
    });

    expect(mocks.resolveSessionMcpServersForLaunch).toHaveBeenCalledWith({
      targetLocation: "local",
      workspacePath: "/cowork/thread-1",
      launchId: expect.stringMatching(/^session-1:/),
      policy: {
        workspaceSurface: "cowork",
        lifecycle: "resume",
        enabled: true,
      },
    });
  });

  it("resolves launch MCP when Plugins are enabled for resume", async () => {
    mocks.resolveRuntimeTargetForWorkspace.mockResolvedValue({
      anyharnessWorkspaceId: "runtime-workspace-1",
      baseUrl: "http://runtime.local",
      location: "local",
      runtimeGeneration: 0,
    });
    mocks.workspacesGet.mockResolvedValue({
      path: "/repo",
      surface: "coding",
    });
    mocks.resolveSessionMcpServersForLaunch.mockResolvedValue({
      mcpBindingSummaries: [{ id: "conn", serverName: "server", outcome: "applied" }],
      mcpServers: [{ transport: "http", serverName: "server", url: "https://example.com/mcp" }],
      warnings: [],
    });
    mocks.resume.mockResolvedValue({ id: "session-1" });

    await resumeSession("session-1", {
      pluginsInCodingSessionsEnabled: true,
    });

    expect(mocks.resolveSessionMcpServersForLaunch).toHaveBeenCalledWith({
      targetLocation: "local",
      workspacePath: "/repo",
      launchId: expect.stringMatching(/^session-1:/),
      policy: {
        workspaceSurface: "coding",
        lifecycle: "resume",
        enabled: true,
      },
    });
  });
});
