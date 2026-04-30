import { beforeEach, describe, expect, it, vi } from "vitest";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import {
  collectInactiveSessionStreamIds,
  createEmptySessionSlot,
  createSessionSlotFromSummary,
  resumeSession,
} from "./session-runtime";
import type { Session } from "@anyharness/sdk";

const mocks = vi.hoisted(() => ({
  resume: vi.fn(),
  resolveRuntimeTargetForWorkspace: vi.fn(),
  resolveSessionMcpServersForLaunch: vi.fn(),
  workspacesGet: vi.fn(),
}));

vi.mock("@anyharness/sdk-react", () => ({
  getAnyHarnessClient: () => ({
    sessions: {
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

  it("resolves cowork launch MCP even when user Plugins are disabled", async () => {
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
      policy: {
        workspaceSurface: "coding",
        lifecycle: "resume",
        enabled: true,
      },
    });
  });
});
