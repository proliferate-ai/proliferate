import type {
  CreateCoworkThreadResponse,
  Session,
} from "@anyharness/sdk";
import { describe, expect, it, vi } from "vitest";
import {
  createCoworkThreadWorkflow,
  type CreateCoworkThreadWorkflowDeps,
} from "#product/lib/workflows/cowork/create-cowork-thread";
import type { PendingWorkspaceEntry } from "#product/lib/domain/workspaces/creation/pending-entry";

describe("createCoworkThreadWorkflow", () => {
  it("uses the selected catalog default for an unattended thread", async () => {
    const deps = resolvedWorkflowDeps();

    await createCoworkThreadWorkflow({
      agentKind: "codex",
      modelId: "gpt-5.6-codex",
      unattendedModeId: "full-access",
      coworkWorkspaceDelegationEnabled: false,
      runtimeUrl: "http://127.0.0.1:4317",
    }, deps);

    expect(deps.createCoworkThread).toHaveBeenCalledWith(expect.objectContaining({
      modeId: "full-access",
    }));
    expect(deps.beginPendingWorkspace).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        initialSession: expect.objectContaining({ modeId: "full-access" }),
      }),
    );
  });

  it("keeps an explicit mode ahead of the catalog default", async () => {
    const deps = resolvedWorkflowDeps();

    await createCoworkThreadWorkflow({
      agentKind: "codex",
      modelId: "gpt-5.6-codex",
      modeId: "read-only",
      unattendedModeId: "full-access",
      coworkWorkspaceDelegationEnabled: false,
      runtimeUrl: "http://127.0.0.1:4317",
    }, deps);

    expect(deps.createCoworkThread).toHaveBeenCalledWith(expect.objectContaining({
      modeId: "read-only",
    }));
  });

  it("omits mode when the selected agent declares no unattended default", async () => {
    const deps = resolvedWorkflowDeps();

    await createCoworkThreadWorkflow({
      agentKind: "grok",
      modelId: "grok-4",
      unattendedModeId: null,
      coworkWorkspaceDelegationEnabled: false,
      runtimeUrl: "http://127.0.0.1:4317",
    }, deps);

    expect(deps.createCoworkThread).toHaveBeenCalledTimes(1);
    expect(vi.mocked(deps.createCoworkThread).mock.calls[0]?.[0]).not.toHaveProperty("modeId");
  });

  it("keeps one Untitled chat identity while the real workspace materializes", async () => {
    const response = coworkThreadResponse();
    const launchDefaults = deferred<Session>();
    let pendingEntry: PendingWorkspaceEntry | null = null;
    const setPendingWorkspaceEntry = vi.fn((entry: PendingWorkspaceEntry | null) => {
      pendingEntry = entry;
    });
    const beginPendingWorkspace = vi.fn<
      CreateCoworkThreadWorkflowDeps["beginPendingWorkspace"]
    >(() => "projected-session");
    const applyLaunchDefaults = vi.fn(() => launchDefaults.promise);

    const deps = {
      createPendingWorkspaceAttemptId: vi.fn(() => "attempt-1"),
      nowMs: vi.fn(() => 100),
      nowIso: vi.fn(() => "2026-07-15T12:00:00Z"),
      startLatencyTimer: vi.fn(() => 0),
      elapsedMs: vi.fn(() => 10),
      elapsedSince: vi.fn(() => 10),
      logLatency: vi.fn(),
      getSelectedWorkspaceId: vi.fn(() => null),
      getPendingWorkspaceEntry: vi.fn(() => pendingEntry),
      isAttemptCurrent: vi.fn(() => true),
      setThreadsCollapsed: vi.fn(),
      beginPendingWorkspace,
      navigateToWorkspaceShell: vi.fn(),
      createCoworkThread: vi.fn(async () => response),
      applyLaunchDefaults,
      upsertLocalWorkspace: vi.fn(),
      upsertWorkspaceSessionRecord: vi.fn(),
      recordCreatedSession: vi.fn(),
      setDraftText: vi.fn(),
      clearDraft: vi.fn(),
      setPendingWorkspaceEntry,
      activateWorkspace: vi.fn(),
      rememberLastViewedSession: vi.fn(),
      trackWorkspaceInteraction: vi.fn(),
      markWorkspaceViewed: vi.fn(),
      markWorkspaceBootstrappedInSession: vi.fn(),
      initWorkspace: vi.fn(async () => undefined),
      showToast: vi.fn(),
    } satisfies CreateCoworkThreadWorkflowDeps;

    const workflow = createCoworkThreadWorkflow({
      agentKind: "codex",
      modelId: "gpt-5.6-codex",
      coworkWorkspaceDelegationEnabled: false,
      runtimeUrl: "http://127.0.0.1:4317",
    }, deps);

    await vi.waitFor(() => expect(applyLaunchDefaults).toHaveBeenCalledTimes(1));

    expect(beginPendingWorkspace.mock.calls[0]?.[0].displayName).toBe("Untitled chat");
    expect(setPendingWorkspaceEntry).toHaveBeenCalledWith(expect.objectContaining({
      attemptId: "attempt-1",
      displayName: "Untitled chat",
      workspaceId: "workspace-cowork",
      request: { kind: "select-existing", workspaceId: "workspace-cowork" },
    }));

    launchDefaults.resolve(response.session);
    await expect(workflow).resolves.toMatchObject({
      workspace: { id: "workspace-cowork" },
      projectedSessionId: "projected-session",
    });
    expect(setPendingWorkspaceEntry).toHaveBeenLastCalledWith(null);
  });
});

function resolvedWorkflowDeps(): CreateCoworkThreadWorkflowDeps {
  const response = coworkThreadResponse();
  return {
    createPendingWorkspaceAttemptId: vi.fn(() => "attempt-1"),
    nowMs: vi.fn(() => 100),
    nowIso: vi.fn(() => "2026-07-15T12:00:00Z"),
    startLatencyTimer: vi.fn(() => 0),
    elapsedMs: vi.fn(() => 10),
    elapsedSince: vi.fn(() => 10),
    logLatency: vi.fn(),
    getSelectedWorkspaceId: vi.fn(() => null),
    getPendingWorkspaceEntry: vi.fn(() => null),
    isAttemptCurrent: vi.fn(() => true),
    setThreadsCollapsed: vi.fn(),
    beginPendingWorkspace: vi.fn(() => "projected-session"),
    navigateToWorkspaceShell: vi.fn(),
    createCoworkThread: vi.fn(async () => response),
    applyLaunchDefaults: vi.fn(async () => response.session),
    upsertLocalWorkspace: vi.fn(),
    upsertWorkspaceSessionRecord: vi.fn(),
    recordCreatedSession: vi.fn(),
    setDraftText: vi.fn(),
    clearDraft: vi.fn(),
    setPendingWorkspaceEntry: vi.fn(),
    activateWorkspace: vi.fn(),
    rememberLastViewedSession: vi.fn(),
    trackWorkspaceInteraction: vi.fn(),
    markWorkspaceViewed: vi.fn(),
    markWorkspaceBootstrappedInSession: vi.fn(),
    initWorkspace: vi.fn(async () => undefined),
    showToast: vi.fn(),
  };
}

function coworkThreadResponse(): CreateCoworkThreadResponse {
  const createdAt = "2026-07-15T12:00:00Z";
  return {
    workspace: {
      availability: "available",
      id: "workspace-cowork",
      path: "/tmp/workspace-cowork",
      repoRootId: "repo-root-1",
      surface: "cowork",
      kind: "local",
      lifecycleState: "active",
      cleanupState: "none",
      createdAt,
      updatedAt: createdAt,
    },
    session: {
      id: "session-cowork",
      workspaceId: "workspace-cowork",
      agentKind: "codex",
      status: "idle",
      actionCapabilities: {},
      createdAt,
      updatedAt: createdAt,
    },
    thread: {
      id: "thread-cowork",
      workspaceId: "workspace-cowork",
      sessionId: "session-cowork",
      repoRootId: "repo-root-1",
      branchName: "cowork/thread-cowork",
      agentKind: "codex",
      title: null,
      createdAt,
      updatedAt: createdAt,
      workspaceDelegationEnabled: false,
    },
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
