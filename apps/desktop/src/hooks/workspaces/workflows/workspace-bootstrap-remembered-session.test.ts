import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceSession } from "@/hooks/access/anyharness/sessions/use-workspace-session-cache";
import { selectSessionWithShellIntentRollback } from "@/hooks/sessions/workflows/session-shell-selection";
import { handleRememberedWorkspaceSessionBootstrap } from "@/hooks/workspaces/workflows/workspace-bootstrap-remembered-session";

vi.mock("@/hooks/sessions/workflows/session-shell-selection", () => ({
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
      getActiveSessionId: () => null,
      getSessionRecord: vi.fn(),
      patchSessionRecord,
      rehydrateSessionSlotFromHistory: rehydrateSessionSlotFromHistory as never,
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
});
