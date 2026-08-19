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
  it("sends the selected target-observed access value for an unattended thread", async () => {
    const deps = resolvedWorkflowDeps();

    await createCoworkThreadWorkflow({
      agentKind: "codex",
      modelId: "gpt-5.6-codex",
      launchControlValues: { mode: "agent-full-access" },
      coworkWorkspaceDelegationEnabled: false,
      runtimeUrl: "http://127.0.0.1:4317",
    }, deps);

    expect(deps.createCoworkThread).toHaveBeenCalledWith(expect.objectContaining({
      controlValues: { mode: "agent-full-access" },
    }));
    expect(deps.beginPendingWorkspace).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        initialSession: expect.objectContaining({ launchControlValues: { mode: "agent-full-access" } }),
      }),
    );
  });

  it("keeps an explicit observed access value", async () => {
    const deps = resolvedWorkflowDeps();

    await createCoworkThreadWorkflow({
      agentKind: "codex",
      modelId: "gpt-5.6-codex",
      launchControlValues: { mode: "read-only" },
      coworkWorkspaceDelegationEnabled: false,
      runtimeUrl: "http://127.0.0.1:4317",
    }, deps);

    expect(deps.createCoworkThread).toHaveBeenCalledWith(expect.objectContaining({
      controlValues: { mode: "read-only" },
    }));
  });

  it("omits mode when the selected agent declares no unattended default", async () => {
    const deps = resolvedWorkflowDeps();

    await createCoworkThreadWorkflow({
      agentKind: "grok",
      modelId: "grok-4",
      launchControlValues: {},
      coworkWorkspaceDelegationEnabled: false,
      runtimeUrl: "http://127.0.0.1:4317",
    }, deps);

    expect(deps.createCoworkThread).toHaveBeenCalledTimes(1);
    expect(vi.mocked(deps.createCoworkThread).mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      controlValues: {},
    }));
  });

  it("keeps one Untitled chat identity while the real workspace materializes", async () => {
    const response = coworkThreadResponse();
    let pendingEntry: PendingWorkspaceEntry | null = null;
    const setPendingWorkspaceEntry = vi.fn((entry: PendingWorkspaceEntry) => {
      pendingEntry = entry;
    });
    const clearPendingWorkspaceEntry = vi.fn(() => {
      pendingEntry = null;
    });
    const beginPendingWorkspace = vi.fn<
      CreateCoworkThreadWorkflowDeps["beginPendingWorkspace"]
    >(() => "projected-session");

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
      isAttemptLive: vi.fn(() => true),
      isAttemptAttended: vi.fn(() => true),
      setThreadsCollapsed: vi.fn(),
      beginPendingWorkspace,
      navigateToWorkspaceShell: vi.fn(),
      createCoworkThread: vi.fn(async () => response),
      upsertLocalWorkspace: vi.fn(),
      upsertWorkspaceSessionRecord: vi.fn(),
      recordCreatedSession: vi.fn(),
      setDraftText: vi.fn(),
      clearDraft: vi.fn(),
      setPendingWorkspaceEntry,
      clearPendingWorkspaceEntry,
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

    await expect(workflow).resolves.toMatchObject({
      workspace: { id: "workspace-cowork" },
      projectedSessionId: "projected-session",
    });
    expect(beginPendingWorkspace.mock.calls[0]?.[0].displayName).toBe("Untitled chat");
    expect(setPendingWorkspaceEntry).toHaveBeenCalledWith(expect.objectContaining({
      attemptId: "attempt-1",
      displayName: "Untitled chat",
      workspaceId: "workspace-cowork",
      request: { kind: "select-existing", workspaceId: "workspace-cowork" },
    }));

    expect(clearPendingWorkspaceEntry).toHaveBeenCalledWith("attempt-1");
  });

  it("adopts a caller's pre-minted attempt id", async () => {
    const deps = resolvedWorkflowDeps();

    await createCoworkThreadWorkflow({
      attemptId: "attempt-from-home",
      agentKind: "codex",
      modelId: "gpt-5.6-codex",
      coworkWorkspaceDelegationEnabled: false,
      runtimeUrl: "http://127.0.0.1:4317",
    }, deps);

    expect(deps.createPendingWorkspaceAttemptId).not.toHaveBeenCalled();
    expect(vi.mocked(deps.beginPendingWorkspace).mock.calls[0]?.[0].attemptId)
      .toBe("attempt-from-home");
    expect(deps.clearPendingWorkspaceEntry).toHaveBeenCalledWith("attempt-from-home");
  });

  it("does not mark an unattended thread viewed, but still tracks recency", async () => {
    const deps = {
      ...resolvedWorkflowDeps(),
      isAttemptAttended: vi.fn(() => false),
    } satisfies CreateCoworkThreadWorkflowDeps;

    await createCoworkThreadWorkflow({
      agentKind: "codex",
      modelId: "gpt-5.6-codex",
      coworkWorkspaceDelegationEnabled: false,
      runtimeUrl: "http://127.0.0.1:4317",
    }, deps);

    // The thread was never on screen, so nothing may claim the user saw it.
    expect(deps.activateWorkspace).not.toHaveBeenCalled();
    expect(deps.rememberLastViewedSession).not.toHaveBeenCalled();
    expect(deps.markWorkspaceViewed).not.toHaveBeenCalled();
    expect(deps.markWorkspaceBootstrappedInSession).not.toHaveBeenCalled();
    // Recency ordering is not a viewed stamp (spec section 8, step 6).
    expect(deps.trackWorkspaceInteraction).toHaveBeenCalledWith(
      "workspace-cowork",
      "2026-07-15T12:00:00Z",
    );
    // Negative control: the pipeline itself still ran to completion.
    expect(deps.clearPendingWorkspaceEntry).toHaveBeenCalledWith("attempt-1");
  });

  it("marks an attended thread viewed", async () => {
    const deps = resolvedWorkflowDeps();

    await createCoworkThreadWorkflow({
      agentKind: "codex",
      modelId: "gpt-5.6-codex",
      coworkWorkspaceDelegationEnabled: false,
      runtimeUrl: "http://127.0.0.1:4317",
    }, deps);

    expect(deps.activateWorkspace).toHaveBeenCalled();
    expect(deps.rememberLastViewedSession).toHaveBeenCalledWith(
      "workspace-cowork",
      "session-cowork",
    );
    expect(deps.markWorkspaceViewed).toHaveBeenCalledWith("workspace-cowork");
    expect(deps.markWorkspaceBootstrappedInSession).toHaveBeenCalledWith("workspace-cowork");
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
    isAttemptLive: vi.fn(() => true),
    isAttemptAttended: vi.fn(() => true),
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
    clearPendingWorkspaceEntry: vi.fn(),
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
