import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  collectInactiveSessionStreamIds,
  createEmptySessionRuntimeRecord,
  createSessionRuntimeRecordFromSummary,
  detachAndCloseSessionStreams,
  fetchSessionHistory,
  pruneInactiveSessionStreams,
  resumeSession,
} from "./session-runtime";
import type { Session, SessionStreamHandle } from "@anyharness/sdk";
import { buildSessionSlotPatchFromSummary } from "@/lib/domain/sessions/summary";
import {
  createEmptySessionRecord,
  getSessionRecord,
  patchSessionRecord,
  putSessionRecord,
} from "@/stores/sessions/session-records";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";
import { useSessionDirectoryStore } from "@/stores/sessions/session-directory-store";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useSessionTranscriptStore } from "@/stores/sessions/session-transcript-store";
import {
  getSessionStreamHandle,
  setSessionStreamHandle,
  resetSessionStreamHandlesForTest,
} from "@/lib/integrations/anyharness/session-stream-handles";

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

vi.mock("@/lib/access/anyharness/runtime-target", () => ({
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
  it("initializes empty pending config changes on new slots", () => {
    expect(createEmptySessionRuntimeRecord("session-1", "codex").pendingConfigChanges).toEqual({});
  });

  it("defaults generic slots to pending relationships", () => {
    expect(createEmptySessionRuntimeRecord("session-1", "codex").sessionRelationship)
      .toEqual({ kind: "pending" });
  });

  it("applies and prunes relationship hints when slots mount later", () => {
    useSessionDirectoryStore.getState().recordRelationshipHint("child-session", {
      kind: "subagent_child",
      parentSessionId: "parent-session",
      sessionLinkId: "link-1",
      relation: "subagent",
      workspaceId: "workspace-1",
    });

    putSessionRecord(
      createEmptySessionRecord("child-session", "codex", {
        workspaceId: "workspace-1",
      }),
    );

    expect(useSessionDirectoryStore.getState().entriesById["child-session"]?.sessionRelationship)
      .toEqual({
        kind: "subagent_child",
        parentSessionId: "parent-session",
        sessionLinkId: "link-1",
        relation: "subagent",
        workspaceId: "workspace-1",
      });
    expect(useSessionDirectoryStore.getState().relationshipHintsBySessionId["child-session"])
      .toBeUndefined();
  });

  it("prunes only idle, non-pending sessions with open stream handles", () => {
    const idleSlot = {
      ...createEmptySessionRuntimeRecord("session-idle", "codex"),
      streamConnectionState: "open" as const,
      transcriptHydrated: true,
      status: "idle" as const,
    };
    const workingSlot = {
      ...createEmptySessionRuntimeRecord("session-working", "codex"),
      streamConnectionState: "open" as const,
      transcriptHydrated: true,
      status: "running" as const,
    };
    const pendingSlot = {
      ...createEmptySessionRuntimeRecord("pending-session:codex:1:abc123", "codex"),
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
    }, {
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

    expect(detachAndCloseSessionStreams(["session-1"])).toBe(1);

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

    expect(pruneInactiveSessionStreams()).toEqual([]);

    const slot = getSessionRecord("session-1")!;
    expect(flushPendingEvents).toHaveBeenCalledTimes(1);
    expect(close).not.toHaveBeenCalled();
    expect(getSessionStreamHandle("session-1")).toBe(handle);
    expect(slot.status).toBe("running");
  });
});

describe("createSessionRuntimeRecordFromSummary", () => {
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

    const slot = createSessionRuntimeRecordFromSummary(session, "workspace-1", {
      titleFallback: "haiku-test",
    });

    expect(slot.sessionId).toBe("child-session");
    expect(slot.workspaceId).toBe("workspace-1");
    expect(slot.title).toBe("haiku-test");
    expect(slot.transcript.sessionMeta.title).toBe("haiku-test");
    expect(slot.transcriptHydrated).toBe(false);
    expect(slot.status).toBe("idle");
  });

  it("preserves existing relationship metadata across summary patches", () => {
    const relationship = {
      kind: "review_child" as const,
      parentSessionId: "parent-session",
      sessionLinkId: "review-link-1",
      relation: "review",
      workspaceId: "workspace-1",
    };
    const slot = createEmptySessionRuntimeRecord("review-session", "codex", {
      workspaceId: "workspace-1",
      sessionRelationship: relationship,
    });
    putSessionRecord(slot);

    const patch = buildSessionSlotPatchFromSummary(
      {
        id: "review-session",
        agentKind: "codex",
        modelId: "gpt-5.4",
        modeId: "default",
        title: "Reviewer",
        status: "idle",
        liveConfig: null,
        executionSummary: null,
        mcpBindingSummaries: null,
        lastPromptAt: null,
      } as Session,
      "workspace-1",
      slot.transcript,
    );
    patchSessionRecord("review-session", patch);

    expect(useSessionDirectoryStore.getState().entriesById["review-session"]?.sessionRelationship)
      .toEqual(relationship);
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
    expect(mocks.resume).toHaveBeenCalledTimes(1);
    const [sessionId, resumeOptions, requestOptions] = mocks.resume.mock.calls[0]!;
    expect(sessionId).toBe("session-1");
    expect(resumeOptions).toEqual({
      mcpBindingSummaries: undefined,
      mcpServers: [],
    });
    if (requestOptions !== undefined) {
      expect(requestOptions).toMatchObject({
        timingCategory: "session.resume",
      });
    }
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
