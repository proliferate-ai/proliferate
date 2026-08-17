// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AnyHarnessResolvedConnection } from "@anyharness/sdk-react";
import { resolveSessionViewState } from "#product/domain/sessions/activity";
import { useHotWorkspaceReconcileAction } from "#product/hooks/workspaces/workflows/use-hot-workspace-reconcile-action";
import type { WorkspaceSession } from "#product/hooks/access/anyharness/sessions/use-workspace-session-cache";
import { useSessionIngestStore } from "#product/stores/sessions/session-ingest-store";
import {
  createEmptySessionRecord,
  getSessionRecord,
  patchSessionRecord,
  putSessionRecord,
  removeSessionRecord,
} from "#product/stores/sessions/session-records";

const SESSION_ID = "session-r15";
const WORKSPACE_ID = "workspace-r15";

const workspaceConnection = {
  anyharnessWorkspaceId: "anyharness-workspace-r15",
  runtimeUrl: "http://localhost:9999",
  authToken: null,
} as AnyHarnessResolvedConnection;

const sessionMeta = {
  id: SESSION_ID,
  dismissedAt: null,
} as unknown as WorkspaceSession;

function renderReconcile(
  rehydrate: ReturnType<typeof vi.fn>,
  applySessionSummary = vi.fn(),
  sessions: WorkspaceSession[] = [sessionMeta],
) {
  const { result } = renderHook(() =>
    useHotWorkspaceReconcileAction({
      applySessionSummary,
      cancelDeferredFileTreePrefetch: vi.fn(),
      loadWorkspaceSessions: vi.fn(async () => sessions),
      prepareFileWorkspace: vi.fn(),
      rehydrateSessionSlotFromHistory: rehydrate,
      scheduleDeferredFileTreePrefetch: vi.fn(),
      workspaceCollections: undefined,
    })
  );
  return result.current;
}

function reconcileInput() {
  return {
    workspaceId: WORKSPACE_ID,
    logicalWorkspaceId: WORKSPACE_ID,
    workspaceConnection,
    sessionId: SESSION_ID,
    selectionNonce: 1,
    isCurrent: () => true,
  };
}

describe("useHotWorkspaceReconcileAction transcript hydration", () => {
  beforeEach(() => {
    removeSessionRecord(SESSION_ID);
    useSessionIngestStore.getState().clear();
    putSessionRecord(createEmptySessionRecord(SESSION_ID, "codex", {
      workspaceId: WORKSPACE_ID,
      materializedSessionId: SESSION_ID,
    }));
  });

  it("performs zero history fetches when the slot stream stayed live without a gap", async () => {
    patchSessionRecord(SESSION_ID, {
      streamConnectionState: "open",
      transcriptHydrated: true,
    });
    useSessionIngestStore.getState().applyStreamProgress(SESSION_ID, {
      lastAppliedSeq: 42,
      lastObservedSeq: 42,
      gapAfterSeq: null,
    });
    const rehydrate = vi.fn(async () => true);

    const reconcile = renderReconcile(rehydrate);
    const outcome = await reconcile(reconcileInput());

    expect(outcome).toBe("completed");
    expect(rehydrate).not.toHaveBeenCalled();
    expect(getSessionRecord(SESSION_ID)?.transcriptHydrated).toBe(true);
  });

  it("repairs a real gap with exactly one incremental history fetch", async () => {
    patchSessionRecord(SESSION_ID, {
      streamConnectionState: "disconnected",
      transcriptHydrated: true,
    });
    useSessionIngestStore.getState().markStale(SESSION_ID, {
      gapAfterSeq: 7,
    });
    const rehydrate = vi.fn(async () => true);

    const reconcile = renderReconcile(rehydrate);
    const outcome = await reconcile(reconcileInput());

    expect(outcome).toBe("completed");
    expect(rehydrate).toHaveBeenCalledTimes(1);
    expect(rehydrate).toHaveBeenCalledWith(
      SESSION_ID,
      expect.objectContaining({ afterSeq: expect.any(Number) }),
    );
    expect(rehydrate.mock.calls[0]?.[1]).not.toMatchObject({ replace: true });
  });

  it("falls back to a full replace only when the tail cannot apply contiguously", async () => {
    patchSessionRecord(SESSION_ID, {
      streamConnectionState: "disconnected",
      transcriptHydrated: true,
    });
    const rehydrate = vi.fn(async (
      _sessionId: string,
      options?: { replace?: boolean },
    ) => options?.replace === true);

    const reconcile = renderReconcile(rehydrate);
    const outcome = await reconcile(reconcileInput());

    expect(outcome).toBe("completed");
    expect(rehydrate).toHaveBeenCalledTimes(2);
    expect(rehydrate.mock.calls[1]?.[1]).toMatchObject({ replace: true });
    expect(getSessionRecord(SESSION_ID)?.transcriptHydrated).toBe(true);
  });

  it("keeps failed large-history recovery retryable after applying terminal authority", async () => {
    const current = getSessionRecord(SESSION_ID)!;
    patchSessionRecord(SESSION_ID, {
      status: "running",
      executionSummary: {
        phase: "running",
        hasLiveHandle: true,
        pendingInteractions: [],
        updatedAt: "2026-08-17T21:56:47Z",
      },
      transcript: {
        ...current.transcript,
        isStreaming: true,
      },
      transcriptHydrated: false,
    });
    const terminalSession = {
      ...sessionMeta,
      status: "idle",
      executionSummary: {
        phase: "idle",
        hasLiveHandle: false,
        pendingInteractions: [],
        updatedAt: "2026-08-17T21:59:22Z",
      },
    } as WorkspaceSession;
    const applySessionSummary = vi.fn((clientSessionId: string, session: WorkspaceSession) => {
      patchSessionRecord(clientSessionId, {
        status: session.status,
        executionSummary: session.executionSummary,
      });
    });
    const rehydrate = vi.fn(async () => false);

    const reconcile = renderReconcile(
      rehydrate,
      applySessionSummary,
      [terminalSession],
    );
    const outcome = await reconcile(reconcileInput());

    expect(outcome).toBe("completed");
    expect(applySessionSummary).toHaveBeenCalledWith(
      SESSION_ID,
      terminalSession,
      WORKSPACE_ID,
    );
    expect(rehydrate).toHaveBeenCalledTimes(2);
    expect(rehydrate.mock.calls[1]?.[1]).toMatchObject({ replace: true });
    expect(getSessionRecord(SESSION_ID)?.transcriptHydrated).toBe(false);
    expect(resolveSessionViewState(getSessionRecord(SESSION_ID))).toBe("idle");
  });

  it("never trusts a slot that was not transcript-hydrated, even with a live stream", async () => {
    patchSessionRecord(SESSION_ID, {
      streamConnectionState: "open",
      transcriptHydrated: false,
    });
    useSessionIngestStore.getState().applyStreamProgress(SESSION_ID, {
      lastAppliedSeq: 42,
      lastObservedSeq: 42,
      gapAfterSeq: null,
    });
    const rehydrate = vi.fn(async () => true);

    const reconcile = renderReconcile(rehydrate);
    const outcome = await reconcile(reconcileInput());

    expect(outcome).toBe("completed");
    expect(rehydrate).toHaveBeenCalledTimes(1);
  });

  it("reconciles a client-keyed slot through its materialized session id", async () => {
    const clientSessionId = "client-session:r15";
    removeSessionRecord(clientSessionId);
    putSessionRecord(createEmptySessionRecord(clientSessionId, "codex", {
      workspaceId: WORKSPACE_ID,
      materializedSessionId: SESSION_ID,
    }));
    patchSessionRecord(clientSessionId, {
      streamConnectionState: "open",
      transcriptHydrated: true,
    });
    useSessionIngestStore.getState().applyStreamProgress(clientSessionId, {
      lastAppliedSeq: 42,
      lastObservedSeq: 42,
      gapAfterSeq: null,
    });
    const rehydrate = vi.fn(async () => true);

    const reconcile = renderReconcile(rehydrate);
    const outcome = await reconcile({
      ...reconcileInput(),
      sessionId: clientSessionId,
    });

    expect(outcome).toBe("completed");
    removeSessionRecord(clientSessionId);
  });

  it("does not trust an open stream whose ingest state reports a gap", async () => {
    patchSessionRecord(SESSION_ID, {
      streamConnectionState: "open",
      transcriptHydrated: true,
    });
    useSessionIngestStore.getState().applyStreamProgress(SESSION_ID, {
      lastAppliedSeq: 42,
      lastObservedSeq: 50,
      gapAfterSeq: 42,
    });
    const rehydrate = vi.fn(async () => true);

    const reconcile = renderReconcile(rehydrate);
    await reconcile(reconcileInput());

    expect(rehydrate).toHaveBeenCalledTimes(1);
  });
});
