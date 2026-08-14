// @vitest-environment jsdom

import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { CloudWorkspaceSummary } from "#product/lib/domain/workspaces/cloud/cloud-workspace-model";
import type { CreateSessionWithResolvedConfigOptions } from "#product/hooks/sessions/workflows/session-creation-types";
import {
  buildPendingWorkspaceUiKey,
  buildSubmittingPendingWorkspaceEntry,
  type PendingWorkspaceEntry,
} from "#product/lib/domain/workspaces/creation/pending-entry";
import {
  EMPTY_PENDING_WORKSPACE_REGISTRY,
  upsertPendingWorkspaceEntry,
} from "#product/lib/domain/workspaces/creation/pending-entry-registry";
import {
  useDeferredHomeLaunchStore,
  type DeferredHomeLaunch,
} from "#product/stores/home/deferred-home-launch-store";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import { useHomeDeferredLaunchRunner } from "#product/hooks/home/lifecycle/use-home-deferred-launch-runner";

const mocks = vi.hoisted(() => ({
  createSessionWithResolvedConfig: vi.fn(),
  workspaceCollections: {
    cloudWorkspaces: [] as CloudWorkspaceSummary[],
  },
}));

vi.mock("#product/hooks/workspaces/cache/use-workspaces", () => ({
  useWorkspaces: () => ({
    data: mocks.workspaceCollections,
    isSuccess: true,
  }),
}));

vi.mock("#product/hooks/sessions/workflows/use-session-creation-actions", () => ({
  useSessionCreationActions: () => ({
    createSessionWithResolvedConfig: mocks.createSessionWithResolvedConfig,
  }),
}));

describe("useHomeDeferredLaunchRunner", () => {
  beforeEach(() => {
    mocks.createSessionWithResolvedConfig.mockReset();
    // Standing in for the real create: activating a session is exactly the
    // camera move a background promotion must not make.
    mocks.createSessionWithResolvedConfig.mockImplementation(
      async (options: CreateSessionWithResolvedConfigOptions) => {
        const sessionId = `session-for:${options.workspaceId}`;
        if (options.activateOnCreate !== false) {
          useSessionSelectionStore.setState({
            activeSessionId: sessionId,
            selectedWorkspaceId: options.workspaceId ?? null,
          });
        }
        return sessionId;
      },
    );
    mocks.workspaceCollections.cloudWorkspaces = [];
    useDeferredHomeLaunchStore.setState({ launches: {} });
    useSessionSelectionStore.setState({
      pendingWorkspaces: EMPTY_PENDING_WORKSPACE_REGISTRY,
      selectedLogicalWorkspaceId: null,
      selectedWorkspaceId: null,
      activeSessionId: null,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("promotes a background launch without stealing selection or the active session", async () => {
    mocks.workspaceCollections.cloudWorkspaces = [cloudWorkspace({ status: "ready" })];
    enqueueLaunch(deferredLaunch());
    useSessionSelectionStore.setState({
      selectedWorkspaceId: "cloud:other",
      selectedLogicalWorkspaceId: "cloud:other",
      activeSessionId: "session-in-other-workspace",
    });

    renderHook(() => useHomeDeferredLaunchRunner());

    await waitFor(() => {
      expect(mocks.createSessionWithResolvedConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: "cloud:cloud-1",
          text: "run the migration",
          activateOnCreate: false,
          targetWorkspaceUiKey: "cloud:cloud-1",
        }),
      );
    });
    const selection = useSessionSelectionStore.getState();
    expect(selection.activeSessionId).toBe("session-in-other-workspace");
    expect(selection.selectedWorkspaceId).toBe("cloud:other");
    await waitFor(() => {
      expect(useDeferredHomeLaunchStore.getState().launches["cloud-1:attempt-1"]).toBeUndefined();
    });
  });

  it("still activates the created session when the user is attending the launch", async () => {
    mocks.workspaceCollections.cloudWorkspaces = [cloudWorkspace({ status: "ready" })];
    enqueueLaunch(deferredLaunch());
    useSessionSelectionStore.setState({
      selectedWorkspaceId: "cloud:cloud-1",
      selectedLogicalWorkspaceId: "cloud:cloud-1",
    });

    renderHook(() => useHomeDeferredLaunchRunner());

    await waitFor(() => {
      expect(mocks.createSessionWithResolvedConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: "cloud:cloud-1",
          activateOnCreate: true,
          targetWorkspaceUiKey: null,
        }),
      );
    });
    await waitFor(() => {
      expect(useSessionSelectionStore.getState().activeSessionId)
        .toBe("session-for:cloud:cloud-1");
    });
  });

  it("treats the pending shell of an attended attempt as attended", async () => {
    mocks.workspaceCollections.cloudWorkspaces = [cloudWorkspace({ status: "ready" })];
    const entry = awaitingEntry("attempt-1", "cloud:cloud-1");
    enqueueLaunch(deferredLaunch());
    useSessionSelectionStore.setState({
      pendingWorkspaces: upsertPendingWorkspaceEntry(EMPTY_PENDING_WORKSPACE_REGISTRY, entry),
      selectedLogicalWorkspaceId: buildPendingWorkspaceUiKey(entry),
      selectedWorkspaceId: null,
    });

    renderHook(() => useHomeDeferredLaunchRunner());

    await waitFor(() => {
      expect(mocks.createSessionWithResolvedConfig).toHaveBeenCalledWith(
        expect.objectContaining({ activateOnCreate: true }),
      );
    });
  });

  it("promotes two deferred launches independently", async () => {
    mocks.workspaceCollections.cloudWorkspaces = [
      cloudWorkspace({ status: "ready" }),
      cloudWorkspace({ id: "cloud-2", status: "ready" }),
    ];
    enqueueLaunch(deferredLaunch());
    enqueueLaunch(deferredLaunch({
      id: "cloud-2:attempt-2",
      workspaceId: "cloud:cloud-2",
      cloudWorkspaceId: "cloud-2",
      cloudAttemptId: "attempt-2",
      promptText: "run the backfill",
    }));

    renderHook(() => useHomeDeferredLaunchRunner());

    await waitFor(() => {
      expect(mocks.createSessionWithResolvedConfig).toHaveBeenCalledTimes(2);
    });
    expect(mocks.createSessionWithResolvedConfig.mock.calls.map(([options]) => options.workspaceId))
      .toEqual(["cloud:cloud-1", "cloud:cloud-2"]);
    await waitFor(() => {
      expect(Object.keys(useDeferredHomeLaunchStore.getState().launches)).toEqual([]);
    });
  });

  it("waits while one launch's workspace is still provisioning", async () => {
    mocks.workspaceCollections.cloudWorkspaces = [
      cloudWorkspace({ status: "ready" }),
      cloudWorkspace({ id: "cloud-2", status: "pending" }),
    ];
    enqueueLaunch(deferredLaunch());
    enqueueLaunch(deferredLaunch({
      id: "cloud-2:attempt-2",
      workspaceId: "cloud:cloud-2",
      cloudWorkspaceId: "cloud-2",
      cloudAttemptId: "attempt-2",
    }));

    renderHook(() => useHomeDeferredLaunchRunner());

    await waitFor(() => {
      expect(mocks.createSessionWithResolvedConfig).toHaveBeenCalledTimes(1);
    });
    expect(useDeferredHomeLaunchStore.getState().launches["cloud-2:attempt-2"]?.status)
      .toBe("pending");
  });

  it("releases the queued prompt when the launch's attempt failed", async () => {
    mocks.workspaceCollections.cloudWorkspaces = [cloudWorkspace({ status: "pending" })];
    enqueueLaunch(deferredLaunch());
    useSessionSelectionStore.setState({
      pendingWorkspaces: upsertPendingWorkspaceEntry(
        EMPTY_PENDING_WORKSPACE_REGISTRY,
        { ...awaitingEntry("attempt-1", "cloud:cloud-1"), stage: "failed" },
      ),
    });

    renderHook(() => useHomeDeferredLaunchRunner());

    await waitFor(() => {
      expect(useDeferredHomeLaunchStore.getState().launches["cloud-1:attempt-1"]).toBeUndefined();
    });
    expect(mocks.createSessionWithResolvedConfig).not.toHaveBeenCalled();
  });
});

function deferredLaunch(
  overrides: Partial<DeferredHomeLaunch> = {},
): DeferredHomeLaunch {
  return {
    id: "cloud-1:attempt-1",
    status: "pending",
    workspaceId: "cloud:cloud-1",
    cloudWorkspaceId: "cloud-1",
    cloudAttemptId: "attempt-1",
    agentKind: "claude",
    modelId: "claude-sonnet-4.5",
    modeId: null,
    promptText: "run the migration",
    promptId: "prompt-1",
    launchIntentId: "intent-1",
    createdAt: Date.now(),
    ...overrides,
  };
}

function enqueueLaunch(launch: DeferredHomeLaunch) {
  useDeferredHomeLaunchStore.getState().enqueue(launch);
}

function awaitingEntry(attemptId: string, workspaceId: string): PendingWorkspaceEntry {
  return {
    ...buildSubmittingPendingWorkspaceEntry({
      attemptId,
      selectedWorkspaceId: null,
      source: "cloud-created",
      displayName: "feature-branch",
      repoLabel: "proliferate-ai/proliferate",
      baseBranchName: "main",
      request: { kind: "select-existing", workspaceId },
    }),
    stage: "awaiting-cloud-ready",
    workspaceId,
  };
}

function cloudWorkspace(
  input: Partial<CloudWorkspaceSummary> & {
    status: CloudWorkspaceSummary["status"];
  },
): CloudWorkspaceSummary {
  return {
    id: input.id ?? "cloud-1",
    displayName: "feature-branch",
    repo: {
      provider: "github",
      owner: "proliferate-ai",
      name: "proliferate",
      branch: "feature-branch",
      baseBranch: "main",
    },
    status: input.status,
    workspaceStatus: input.status,
    runtime: undefined,
    statusDetail: null,
    lastError: null,
    templateVersion: null,
    updatedAt: null,
    createdAt: null,
    readyAt: input.status === "ready" ? "2026-04-14T00:00:00Z" : null,
    postReadyPhase: "",
    postReadyFilesTotal: 0,
    postReadyFilesApplied: 0,
    postReadyStartedAt: null,
    postReadyCompletedAt: null,
    visibility: "private",
  };
}
