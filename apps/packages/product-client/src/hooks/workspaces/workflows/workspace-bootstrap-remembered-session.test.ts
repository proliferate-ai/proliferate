import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceSession } from "#product/hooks/access/anyharness/sessions/use-workspace-session-cache";
import { selectSessionWithShellIntentRollback } from "#product/hooks/sessions/workflows/session-shell-selection";
import { handleRememberedWorkspaceSessionBootstrap } from "#product/hooks/workspaces/workflows/workspace-bootstrap-remembered-session";

vi.mock("#product/hooks/sessions/workflows/session-shell-selection", () => ({
  selectSessionWithShellIntentRollback: vi.fn(),
}));

function session(id: string): WorkspaceSession {
  return {
    id,
    workspaceId: "workspace-1",
    updatedAt: "2026-06-01T12:00:00.000Z",
  } as unknown as WorkspaceSession;
}

describe("handleRememberedWorkspaceSessionBootstrap", () => {
  beforeEach(() => {
    vi.mocked(selectSessionWithShellIntentRollback).mockReset();
  });

  it("asks the parent bootstrap flow to return when remembered selection is stale", async () => {
    vi.mocked(selectSessionWithShellIntentRollback).mockResolvedValueOnce({
      result: "stale",
      sessionId: "session-1",
      guard: {
        workspaceId: "workspace-1",
        workspaceSelectionNonce: 1,
        token: 1,
      },
      reason: "selection-replaced",
    });
    const rehydrateSessionSlotFromHistory = vi.fn();
    const patchSessionRecord = vi.fn();

    const result = await handleRememberedWorkspaceSessionBootstrap({
      lastViewedSessionByWorkspace: {
        "logical-workspace-1": "session-1",
      },
      latencyFlowId: null,
      logicalWorkspaceId: "logical-workspace-1",
      measurementOperationId: null,
      sessions: [session("session-1")],
      startedAt: performance.now(),
      workspaceId: "workspace-1",
      isCurrent: () => true,
    }, {
      clearLastViewedSession: vi.fn(),
      findClientSessionIdByMaterializedSessionId: vi.fn(() => null),
      getActiveSessionId: () => null,
      getSessionRecord: vi.fn(),
      patchSessionRecord,
      rehydrateSessionSlotFromHistory: rehydrateSessionSlotFromHistory as never,
      removeSessionRecord: vi.fn(),
      selectSession: vi.fn() as never,
      setActiveSessionId: vi.fn(),
    });

    expect(result.shouldReturn).toBe(true);
    expect(selectSessionWithShellIntentRollback).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: "workspace-1",
      sessionId: "session-1",
    }));
    expect(rehydrateSessionSlotFromHistory).not.toHaveBeenCalled();
    expect(patchSessionRecord).not.toHaveBeenCalled();
  });

  it("replaces a setup surface with an authoritative real session without clearing first", async () => {
    vi.mocked(selectSessionWithShellIntentRollback).mockImplementationOnce(async () => {
      expect(setActiveSessionId).not.toHaveBeenCalledWith(null);
      setActiveSessionId("session-1");
      return undefined;
    });
    const setupSessionId = "client-session:workspace-setup:workspace-1";
    const setActiveSessionId = vi.fn();
    const removeSessionRecord = vi.fn();

    const result = await handleRememberedWorkspaceSessionBootstrap({
      lastViewedSessionByWorkspace: {},
      latencyFlowId: null,
      logicalWorkspaceId: "logical-workspace-1",
      measurementOperationId: null,
      sessions: [session("session-1")],
      startedAt: performance.now(),
      workspaceId: "workspace-1",
      isCurrent: () => true,
    }, {
      clearLastViewedSession: vi.fn(),
      findClientSessionIdByMaterializedSessionId: vi.fn(() => null),
      getActiveSessionId: () => setupSessionId,
      getSessionRecord: vi.fn(() => ({
        sessionId: setupSessionId,
        workspaceId: "workspace-1",
      })) as never,
      patchSessionRecord: vi.fn(),
      rehydrateSessionSlotFromHistory: vi.fn() as never,
      removeSessionRecord,
      selectSession: vi.fn() as never,
      setActiveSessionId,
    });

    expect(result.shouldReturn).toBe(false);
    expect(setActiveSessionId).not.toHaveBeenCalledWith(null);
    expect(removeSessionRecord).toHaveBeenCalledWith(setupSessionId);
  });

  it("selects and hydrates the existing client projection for a runtime session", async () => {
    const clientSessionId = "client-session:codex:existing";
    const materializedSessionId = "runtime-session-existing";
    const rehydrateSessionSlotFromHistory = vi.fn().mockResolvedValue(true);
    const patchSessionRecord = vi.fn();
    const findClientSessionIdByMaterializedSessionId = vi.fn(
      (sessionId: string) => sessionId === materializedSessionId
        ? clientSessionId
        : null,
    );
    vi.mocked(selectSessionWithShellIntentRollback).mockResolvedValueOnce(undefined);

    await handleRememberedWorkspaceSessionBootstrap({
      lastViewedSessionByWorkspace: {},
      latencyFlowId: null,
      logicalWorkspaceId: "logical-workspace-1",
      measurementOperationId: null,
      sessions: [session(materializedSessionId)],
      startedAt: performance.now(),
      workspaceId: "workspace-1",
      isCurrent: () => true,
    }, {
      clearLastViewedSession: vi.fn(),
      findClientSessionIdByMaterializedSessionId,
      getActiveSessionId: () => null,
      getSessionRecord: vi.fn(),
      patchSessionRecord,
      rehydrateSessionSlotFromHistory: rehydrateSessionSlotFromHistory as never,
      removeSessionRecord: vi.fn(),
      selectSession: vi.fn() as never,
      setActiveSessionId: vi.fn(),
    });

    expect(findClientSessionIdByMaterializedSessionId).toHaveBeenCalledWith(
      materializedSessionId,
    );
    expect(selectSessionWithShellIntentRollback).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: "workspace-1",
      sessionId: clientSessionId,
    }));
    expect(rehydrateSessionSlotFromHistory).toHaveBeenCalledWith(
      clientSessionId,
      expect.any(Object),
    );
    expect(patchSessionRecord).toHaveBeenCalledWith(
      clientSessionId,
      { transcriptHydrated: true },
    );
  });

  it("hydrates the client identity discovered while selecting a runtime session", async () => {
    const clientSessionId = "client-session:codex:materializing";
    const materializedSessionId = "runtime-session-materializing";
    const rehydrateSessionSlotFromHistory = vi.fn().mockResolvedValue(true);
    const patchSessionRecord = vi.fn();
    vi.mocked(selectSessionWithShellIntentRollback).mockResolvedValueOnce({
      result: "completed",
      sessionId: clientSessionId,
      guard: {
        workspaceId: "workspace-1",
        workspaceSelectionNonce: 1,
        token: 1,
      },
      activeSessionVersion: 1,
    });

    await handleRememberedWorkspaceSessionBootstrap({
      lastViewedSessionByWorkspace: {},
      latencyFlowId: null,
      logicalWorkspaceId: "logical-workspace-1",
      measurementOperationId: null,
      sessions: [session(materializedSessionId)],
      startedAt: performance.now(),
      workspaceId: "workspace-1",
      isCurrent: () => true,
    }, {
      clearLastViewedSession: vi.fn(),
      findClientSessionIdByMaterializedSessionId: vi.fn(() => null),
      getActiveSessionId: () => clientSessionId,
      getSessionRecord: vi.fn(),
      patchSessionRecord,
      rehydrateSessionSlotFromHistory: rehydrateSessionSlotFromHistory as never,
      removeSessionRecord: vi.fn(),
      selectSession: vi.fn() as never,
      setActiveSessionId: vi.fn(),
    });

    expect(selectSessionWithShellIntentRollback).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: materializedSessionId,
    }));
    expect(rehydrateSessionSlotFromHistory).toHaveBeenCalledWith(
      clientSessionId,
      expect.any(Object),
    );
    expect(patchSessionRecord).toHaveBeenCalledWith(
      clientSessionId,
      { transcriptHydrated: true },
    );
  });
});
