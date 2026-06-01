import { describe, expect, it, vi } from "vitest";
import type { WorkspaceSession } from "@/hooks/access/anyharness/sessions/use-workspace-session-cache";
import { handleEmptyWorkspaceBootstrap } from "@/hooks/workspaces/workflows/workspace-bootstrap-empty-session";

function session(id: string): WorkspaceSession {
  return { id, workspaceId: "workspace-1" } as unknown as WorkspaceSession;
}

describe("handleEmptyWorkspaceBootstrap", () => {
  it("clears remembered sessions with the logical workspace key", async () => {
    const clearLastViewedSession = vi.fn();
    const createEmptySessionWithResolvedConfig = vi.fn();
    const ensureCloudAgentCatalog = vi.fn();
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

    expect(clearLastViewedSession).toHaveBeenCalledWith("logical-workspace-1");
    expect(clearLastViewedSession).not.toHaveBeenCalledWith("materialized-workspace-1");
    expect(result.shouldReturn).toBe(true);
    expect(setActiveSessionId).toHaveBeenCalledWith(null);
    expect(markWorkspaceBootstrappedInSession).toHaveBeenCalledWith("materialized-workspace-1");
    expect(ensureCloudAgentCatalog).not.toHaveBeenCalled();
    expect(createEmptySessionWithResolvedConfig).not.toHaveBeenCalled();
  });
});
