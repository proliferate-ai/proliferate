import { beforeEach, describe, expect, it, vi } from "vitest";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import {
  collectInactiveSessionStreamIds,
  createEmptySessionSlot,
  resumeSession,
} from "./session-runtime";

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

describe("resumeSession", () => {
  it("sends explicit empty MCP arrays when resolution finds no launchable connectors", async () => {
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
      powersInCodingSessionsEnabled: false,
    });

    expect(mocks.resume).toHaveBeenCalledWith(
      "session-1",
      {
        mcpBindingSummaries: [],
        mcpServers: [],
      },
      undefined,
    );
  });
});
