// @vitest-environment jsdom

import type { AnyHarnessResolvedConnection } from "@anyharness/sdk-react";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceSession } from "#product/hooks/access/anyharness/sessions/use-workspace-session-cache";
import { useHotWorkspaceReconcileAction } from "#product/hooks/workspaces/workflows/use-hot-workspace-reconcile-action";
import { useSessionDirectoryStore } from "#product/stores/sessions/session-directory-store";
import {
  createEmptySessionRecord,
  getSessionRecord,
  putSessionRecord,
} from "#product/stores/sessions/session-records";
import { useSessionTranscriptStore } from "#product/stores/sessions/session-transcript-store";

beforeEach(() => {
  useSessionDirectoryStore.getState().clearEntries();
  useSessionTranscriptStore.getState().clearEntries();
});

describe("useHotWorkspaceReconcileAction", () => {
  it("matches a projected client slot to its materialized runtime session", async () => {
    const clientSessionId = "client-session:codex:existing";
    const materializedSessionId = "runtime-session-existing";
    putSessionRecord(createEmptySessionRecord(clientSessionId, "codex", {
      materializedSessionId,
      workspaceId: "workspace-1",
    }));
    const rehydrateSessionSlotFromHistory = vi.fn().mockResolvedValue(true);
    const loadWorkspaceSessions = vi.fn().mockResolvedValue([{
      id: materializedSessionId,
      agentKind: "codex",
      title: "Runtime title",
      workspaceId: "workspace-1",
    } as WorkspaceSession]);
    const { result } = renderHook(() => useHotWorkspaceReconcileAction({
      cancelDeferredFileTreePrefetch: vi.fn(),
      loadWorkspaceSessions,
      prepareFileWorkspace: vi.fn(),
      rehydrateSessionSlotFromHistory,
      scheduleDeferredFileTreePrefetch: vi.fn(),
      workspaceCollections: undefined,
    }));

    let outcome!: "completed" | "stale" | "session_missing";
    await act(async () => {
      outcome = await result.current({
        workspaceId: "workspace-1",
        logicalWorkspaceId: "logical:workspace-1",
        workspaceConnection: {
          runtimeUrl: "http://runtime.test",
          anyharnessWorkspaceId: "workspace-1",
        } as AnyHarnessResolvedConnection,
        sessionId: clientSessionId,
        selectionNonce: 1,
        isCurrent: () => true,
      });
    });

    expect(outcome).toBe("completed");
    expect(rehydrateSessionSlotFromHistory).toHaveBeenCalledWith(
      clientSessionId,
      expect.any(Object),
    );
    expect(getSessionRecord(clientSessionId)).toMatchObject({
      title: "Runtime title",
      transcriptHydrated: true,
    });
    expect(useSessionDirectoryStore.getState().entriesById[materializedSessionId])
      .toBeUndefined();
  });
});
