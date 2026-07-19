import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceSession } from "#product/hooks/access/anyharness/sessions/use-workspace-session-cache";
import {
  handleEmptyWorkspaceBootstrap,
  handleEmptyWorkspaceBootstrapWithRecovery,
} from "#product/hooks/workspaces/workflows/workspace-bootstrap-empty-session";
import {
  createEmptySessionRecord,
  getSessionRecord,
  patchSessionRecord,
  putSessionRecord,
} from "#product/stores/sessions/session-records";
import { useSessionDirectoryStore } from "#product/stores/sessions/session-directory-store";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import { useSessionTranscriptStore } from "#product/stores/sessions/session-transcript-store";
import { resolveWorkspaceSetupSessionId } from "#product/lib/domain/workspaces/selection/setup-session";

const mocks = vi.hoisted(() => ({
  getAgentLaunchOptions: vi.fn(),
}));

vi.mock("#product/lib/access/anyharness/agents", () => ({
  getAgentLaunchOptions: mocks.getAgentLaunchOptions,
}));

function session(id: string): WorkspaceSession {
  return { id, workspaceId: "workspace-1" } as unknown as WorkspaceSession;
}

describe("handleEmptyWorkspaceBootstrap", () => {
  beforeEach(() => {
    useSessionDirectoryStore.getState().clearEntries();
    useSessionTranscriptStore.getState().clearEntries();
    useSessionSelectionStore.setState({
      activeSessionId: null,
      workspaceSessionRecovery: null,
    });
    mocks.getAgentLaunchOptions.mockReset().mockResolvedValue(null);
  });

  it("clears remembered sessions with the logical workspace key", async () => {
    const clearLastViewedSession = vi.fn();
    const createEmptySessionWithResolvedConfig = vi.fn();
    const ensureCloudAgentCatalog = vi.fn().mockResolvedValue(null);
    const fetchWorkspaceSessions = vi.fn().mockResolvedValue([session("dismissed-session")]);
    const markWorkspaceBootstrappedInSession = vi.fn();

    const result = await handleEmptyWorkspaceBootstrap({
      agentsByKind: {} as never,
      latencyFlowId: null,
      logicalWorkspaceId: "logical-workspace-1",
      measurementOperationId: null,
      preferences: {} as never,
      requestOptions: undefined,
      sessions: [],
      shouldClearLastViewedSession: true,
      startedAt: performance.now(),
      timeoutMs: 1_000,
      workspaceConnection: {
        anyharnessWorkspaceId: "anyharness-workspace-1",
        runtimeUrl: "http://runtime.test",
      } as never,
      workspaceId: "materialized-workspace-1",
      isCurrent: () => true,
    }, {
      clearLastViewedSession,
      createEmptySessionWithResolvedConfig: createEmptySessionWithResolvedConfig as never,
      ensureCloudAgentCatalog: ensureCloudAgentCatalog as never,
      fetchWorkspaceSessions: fetchWorkspaceSessions as never,
      getActiveSessionId: () => null,
      getPendingWorkspaceEntry: () => null,
      getSessionRecord,
      markWorkspaceBootstrappedInSession,
    });

    expect(clearLastViewedSession).toHaveBeenCalledWith("logical-workspace-1");
    expect(clearLastViewedSession).not.toHaveBeenCalledWith("materialized-workspace-1");
    expect(ensureCloudAgentCatalog).toHaveBeenCalled();
    expect(createEmptySessionWithResolvedConfig).not.toHaveBeenCalled();
    expect(result.shouldReturn).toBe(false);
    expect(markWorkspaceBootstrappedInSession).not.toHaveBeenCalled();
  });

  it("retains one non-durable setup surface when no complete launch identity exists", async () => {
    const deps = {
      clearLastViewedSession: vi.fn(),
      createEmptySessionWithResolvedConfig: vi.fn() as never,
      ensureCloudAgentCatalog: vi.fn().mockResolvedValue(null) as never,
      fetchWorkspaceSessions: vi.fn().mockResolvedValue([]) as never,
      getActiveSessionId: () => useSessionSelectionStore.getState().activeSessionId,
      getPendingWorkspaceEntry: () => null,
      getSessionRecord,
      markWorkspaceBootstrappedInSession: vi.fn(),
    };
    const input = {
      agentsByKind: {} as never,
      latencyFlowId: null,
      logicalWorkspaceId: "logical-workspace-1",
      measurementOperationId: null,
      preferences: {} as never,
      requestOptions: undefined,
      sessions: [],
      shouldClearLastViewedSession: true,
      startedAt: performance.now(),
      timeoutMs: 100,
      workspaceConnection: {
        anyharnessWorkspaceId: "anyharness-workspace-1",
        runtimeUrl: "http://runtime.test",
      } as never,
      workspaceId: "materialized-workspace-1",
      isCurrent: () => true,
    };

    const first = await handleEmptyWorkspaceBootstrapWithRecovery(input, deps);
    const setupSessionId = resolveWorkspaceSetupSessionId("materialized-workspace-1");
    const second = await handleEmptyWorkspaceBootstrapWithRecovery(input, deps);

    expect(first).toEqual({ shouldReturn: true, enteredRecovery: true });
    expect(second).toEqual({ shouldReturn: true, enteredRecovery: true });
    expect(deps.createEmptySessionWithResolvedConfig).not.toHaveBeenCalled();
    expect(useSessionSelectionStore.getState().activeSessionId).toBe(setupSessionId);
    expect(Object.keys(useSessionDirectoryStore.getState().entriesById))
      .toEqual([setupSessionId]);
    expect(useSessionSelectionStore.getState().workspaceSessionRecovery).toEqual({
      workspaceId: "materialized-workspace-1",
      logicalWorkspaceId: "logical-workspace-1",
      sessionId: setupSessionId,
      reason: "launch-configuration-unavailable",
    });
  });

  it("promotes the same setup surface through the creation owner after configuration appears", async () => {
    const setupSessionId = resolveWorkspaceSetupSessionId("materialized-workspace-1");
    const launchAgent = {
      kind: "claude",
      displayName: "Claude Code",
      description: null,
      defaultModelId: "sonnet",
      unattendedModeId: null,
      models: [{
        id: "sonnet",
        displayName: "Sonnet",
        description: null,
        aliases: [],
        status: "active",
        isDefault: true,
      }],
      launchControls: [],
    };
    const ensureCloudAgentCatalog = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ agents: [launchAgent] });
    const createEmptySessionWithResolvedConfig = vi.fn(async (options: {
      clientSessionId: string;
    }) => {
      expect(useSessionSelectionStore.getState().activeSessionId).toBe(setupSessionId);
      expect(options.clientSessionId).toBe(setupSessionId);
      patchSessionRecord(setupSessionId, {
        agentKind: "claude",
        materializedSessionId: "runtime-session-1",
        modelId: "sonnet",
      });
      return setupSessionId;
    });
    const deps = {
      clearLastViewedSession: vi.fn(),
      createEmptySessionWithResolvedConfig: createEmptySessionWithResolvedConfig as never,
      ensureCloudAgentCatalog: ensureCloudAgentCatalog as never,
      fetchWorkspaceSessions: vi.fn().mockResolvedValue([]) as never,
      getActiveSessionId: () => useSessionSelectionStore.getState().activeSessionId,
      getPendingWorkspaceEntry: () => null,
      getSessionRecord,
      markWorkspaceBootstrappedInSession: vi.fn(),
    };
    const input = {
      agentsByKind: new Map([["claude", { readiness: "ready" }]]),
      latencyFlowId: null,
      logicalWorkspaceId: "logical-workspace-1",
      measurementOperationId: null,
      preferences: {
        defaultChatAgentKind: "claude",
        defaultChatModelIdByAgentKind: { claude: "sonnet" },
        chatModelVisibilityOverridesByAgentKind: {},
      },
      requestOptions: undefined,
      sessions: [],
      shouldClearLastViewedSession: true,
      startedAt: performance.now(),
      timeoutMs: 100,
      workspaceConnection: {
        anyharnessWorkspaceId: "anyharness-workspace-1",
        runtimeUrl: "http://runtime.test",
      },
      workspaceId: "materialized-workspace-1",
      isCurrent: () => true,
    } as const;

    await handleEmptyWorkspaceBootstrapWithRecovery(input as never, deps);
    const recovered = await handleEmptyWorkspaceBootstrapWithRecovery(input as never, deps);

    expect(recovered).toEqual({ shouldReturn: false, enteredRecovery: false });
    expect(createEmptySessionWithResolvedConfig).toHaveBeenCalledOnce();
    expect(createEmptySessionWithResolvedConfig).toHaveBeenCalledWith(expect.objectContaining({
      clientSessionId: setupSessionId,
      agentKind: "claude",
      modelId: "sonnet",
      preserveProjectedSessionOnCreateFailure: true,
      reuseInFlightEmptySession: true,
    }));
    expect(useSessionSelectionStore.getState().activeSessionId).toBe(setupSessionId);
    expect(getSessionRecord(setupSessionId)?.materializedSessionId)
      .toBe("runtime-session-1");
  });

  it("retains and rematerializes one selected projected shell only after explicit Retry", async () => {
    const projectedSessionId = "client-session:claude:recovery";
    const createEmptySessionWithResolvedConfig = vi.fn()
      .mockImplementationOnce(async (options: {
        agentKind: string;
        modelId: string;
        workspaceId: string;
      }) => {
        putSessionRecord({
          ...createEmptySessionRecord(projectedSessionId, options.agentKind, {
            workspaceId: options.workspaceId,
            materializedSessionId: null,
            modelId: options.modelId,
          }),
          status: "errored",
          transcriptHydrated: true,
        });
        useSessionSelectionStore.getState().setActiveSessionId(projectedSessionId);
        throw new Error("runtime unavailable");
      })
      .mockImplementationOnce(async (options: { clientSessionId: string }) => {
        useSessionSelectionStore.getState().setActiveSessionId(options.clientSessionId);
        patchSessionRecord(options.clientSessionId, {
          materializedSessionId: "runtime-session-1",
          status: "idle",
        });
        return options.clientSessionId;
      });
    const launchAgent = {
      kind: "claude",
      displayName: "Claude Code",
      description: null,
      defaultModelId: "sonnet",
      unattendedModeId: null,
      models: [{
        id: "sonnet",
        displayName: "Sonnet",
        description: null,
        aliases: [],
        status: "active",
        isDefault: true,
      }],
      launchControls: [],
    };
    const input = {
      agentsByKind: new Map([["claude", { readiness: "ready" }]]),
      latencyFlowId: null,
      logicalWorkspaceId: "logical-workspace-1",
      measurementOperationId: null,
      preferences: {
        defaultChatAgentKind: "claude",
        defaultChatModelIdByAgentKind: { claude: "sonnet" },
        chatModelVisibilityOverridesByAgentKind: {},
      },
      requestOptions: undefined,
      sessions: [],
      shouldClearLastViewedSession: true,
      startedAt: performance.now(),
      timeoutMs: 1_000,
      workspaceConnection: {
        anyharnessWorkspaceId: "anyharness-workspace-1",
        runtimeUrl: "http://runtime.test",
      },
      workspaceId: "materialized-workspace-1",
      isCurrent: () => true,
    } as const;
    const deps = {
      clearLastViewedSession: vi.fn(),
      createEmptySessionWithResolvedConfig: createEmptySessionWithResolvedConfig as never,
      ensureCloudAgentCatalog: vi.fn().mockResolvedValue({ agents: [launchAgent] }) as never,
      fetchWorkspaceSessions: vi.fn().mockResolvedValue([]) as never,
      getActiveSessionId: () => useSessionSelectionStore.getState().activeSessionId,
      getPendingWorkspaceEntry: () => null,
      getSessionRecord,
      markWorkspaceBootstrappedInSession: vi.fn(),
    };

    const failed = await handleEmptyWorkspaceBootstrapWithRecovery(input as never, deps);

    expect(failed).toEqual({ shouldReturn: true, enteredRecovery: true });
    expect(createEmptySessionWithResolvedConfig).toHaveBeenCalledTimes(1);
    expect(createEmptySessionWithResolvedConfig).toHaveBeenNthCalledWith(1, expect.objectContaining({
      clientSessionId: null,
      preserveProjectedSessionOnCreateFailure: true,
      reuseInFlightEmptySession: true,
    }));
    expect(useSessionSelectionStore.getState().activeSessionId).toBe(projectedSessionId);
    expect(useSessionSelectionStore.getState().workspaceSessionRecovery).toEqual({
      workspaceId: "materialized-workspace-1",
      logicalWorkspaceId: "logical-workspace-1",
      sessionId: projectedSessionId,
      reason: "session-create-failed",
    });
    expect(getSessionRecord(projectedSessionId)?.materializedSessionId).toBeNull();

    useSessionSelectionStore.getState().setWorkspaceSessionRecovery(null);
    const recovered = await handleEmptyWorkspaceBootstrapWithRecovery(input as never, deps);

    expect(recovered).toEqual({ shouldReturn: false, enteredRecovery: false });
    expect(createEmptySessionWithResolvedConfig).toHaveBeenCalledTimes(2);
    expect(createEmptySessionWithResolvedConfig).toHaveBeenNthCalledWith(2, expect.objectContaining({
      clientSessionId: projectedSessionId,
      agentKind: "claude",
      modelId: "sonnet",
      preserveProjectedSessionOnCreateFailure: true,
    }));
    expect(useSessionSelectionStore.getState().activeSessionId).toBe(projectedSessionId);
    expect(getSessionRecord(projectedSessionId)?.materializedSessionId)
      .toBe("runtime-session-1");
    expect(useSessionSelectionStore.getState().workspaceSessionRecovery).toBeNull();
  });
});
