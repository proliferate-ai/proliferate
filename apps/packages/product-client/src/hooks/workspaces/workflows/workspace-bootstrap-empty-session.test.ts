import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceSession } from "#product/hooks/access/anyharness/sessions/use-workspace-session-cache";
import {
  handleEmptyWorkspaceBootstrap,
  handleEmptyWorkspaceBootstrapWithRecovery,
} from "#product/hooks/workspaces/workflows/workspace-bootstrap-empty-session";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";

function session(id: string): WorkspaceSession {
  return { id, workspaceId: "workspace-1" } as unknown as WorkspaceSession;
}

describe("handleEmptyWorkspaceBootstrap", () => {
  beforeEach(() => {
    useSessionSelectionStore.setState({ workspaceSessionRecovery: null });
  });

  it("clears remembered sessions with the logical workspace key", async () => {
    const clearLastViewedSession = vi.fn();
    const createEmptySessionWithResolvedConfig = vi.fn();
    // The bootstrap awaits ensureCloudAgentCatalog().catch(...), so the mock must
    // return a promise. An empty catalog yields no default launch agent.
    const ensureCloudAgentCatalog = vi.fn().mockResolvedValue(null);
    const fetchWorkspaceSessions = vi.fn().mockResolvedValue([session("dismissed-session")]);
    const markWorkspaceBootstrappedInSession = vi.fn();
    const setActiveSessionId = vi.fn();

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
      getPendingWorkspaceEntry: () => null,
      markWorkspaceBootstrappedInSession,
      setActiveSessionId,
    });

    // Core intent: the remembered-session clear keys off the logical workspace id,
    // never the materialized one.
    expect(clearLastViewedSession).toHaveBeenCalledWith("logical-workspace-1");
    expect(clearLastViewedSession).not.toHaveBeenCalledWith("materialized-workspace-1");
    // With no pending projected session the bootstrap falls through to the
    // default-session path: it loads the launch catalog, finds no default launch
    // (empty catalog), so it creates nothing and reports shouldReturn=false.
    expect(ensureCloudAgentCatalog).toHaveBeenCalled();
    expect(createEmptySessionWithResolvedConfig).not.toHaveBeenCalled();
    expect(result.shouldReturn).toBe(false);
    // setActiveSessionId / markWorkspaceBootstrappedInSession only fire on the
    // projected-pending-session early return, which this input does not take.
    expect(setActiveSessionId).not.toHaveBeenCalled();
    expect(markWorkspaceBootstrappedInSession).not.toHaveBeenCalled();
  });

  it("enters explicit recovery when an authoritative empty workspace has no usable launch", async () => {
    const result = await handleEmptyWorkspaceBootstrapWithRecovery({
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
      clearLastViewedSession: vi.fn(),
      createEmptySessionWithResolvedConfig: vi.fn() as never,
      ensureCloudAgentCatalog: vi.fn().mockResolvedValue(null) as never,
      fetchWorkspaceSessions: vi.fn().mockResolvedValue([]) as never,
      getActiveSessionId: () => null,
      getPendingWorkspaceEntry: () => null,
      markWorkspaceBootstrappedInSession: vi.fn(),
      setActiveSessionId: vi.fn(),
    });

    expect(result).toEqual({ shouldReturn: true, enteredRecovery: true });
    expect(useSessionSelectionStore.getState().workspaceSessionRecovery).toEqual({
      workspaceId: "materialized-workspace-1",
      logicalWorkspaceId: "logical-workspace-1",
      reason: "no-visible-session",
    });
  });
});
