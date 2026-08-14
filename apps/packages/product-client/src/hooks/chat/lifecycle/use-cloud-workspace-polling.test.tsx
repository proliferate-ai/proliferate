// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CloudWorkspaceSummary } from "#product/lib/domain/workspaces/cloud/cloud-workspace-model";
import {
  buildPendingWorkspaceUiKey,
  buildSubmittingPendingWorkspaceEntry,
  type PendingWorkspaceEntry,
} from "#product/lib/domain/workspaces/creation/pending-entry";
import {
  createEmptySessionRecord,
  putSessionRecord,
} from "#product/stores/sessions/session-records";
import { useSessionDirectoryStore } from "#product/stores/sessions/session-directory-store";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";
import {
  EMPTY_PENDING_WORKSPACE_REGISTRY,
  pendingWorkspaceEntry,
  upsertPendingWorkspaceEntry,
} from "#product/lib/domain/workspaces/creation/pending-entry-registry";
import { useSessionTranscriptStore } from "#product/stores/sessions/session-transcript-store";
import { useCloudWorkspacePolling } from "#product/hooks/chat/lifecycle/use-cloud-workspace-polling";

const mocks = vi.hoisted(() => ({
  refreshCloudWorkspace: vi.fn(),
  selectWorkspace: vi.fn(),
  materializePendingWorkspaceSessions: vi.fn(),
  trackWorkspaceInteraction: vi.fn(),
  notifyUnattendedPendingWorkspaceFailure: vi.fn(),
  workspaceCollections: {
    cloudWorkspaces: [] as CloudWorkspaceSummary[],
  },
}));

vi.mock("#product/hooks/workspaces/workflows/pending-workspace-failure-notice", () => ({
  notifyUnattendedPendingWorkspaceFailure: mocks.notifyUnattendedPendingWorkspaceFailure,
}));

vi.mock("#product/stores/preferences/workspace-ui-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("#product/stores/preferences/workspace-ui-store")>();
  return {
    ...actual,
    trackWorkspaceInteraction: mocks.trackWorkspaceInteraction,
  };
});

vi.mock("#product/hooks/workspaces/cache/use-workspaces", () => ({
  useWorkspaces: () => ({
    data: mocks.workspaceCollections,
  }),
}));

vi.mock("#product/hooks/cloud/workflows/use-cloud-workspace-actions", () => ({
  useCloudWorkspaceActions: () => ({
    refreshCloudWorkspace: mocks.refreshCloudWorkspace,
  }),
}));

vi.mock("#product/hooks/workspaces/workflows/selection/use-workspace-selection", () => ({
  useWorkspaceSelection: () => ({
    selectWorkspace: mocks.selectWorkspace,
  }),
}));

vi.mock("#product/hooks/workspaces/workflows/use-pending-workspace-session-materialization", () => ({
  usePendingWorkspaceSessionMaterialization: () => mocks.materializePendingWorkspaceSessions,
}));

vi.mock("#product/lib/infra/measurement/measurement-port", () => ({
  elapsedMs: () => 0,
  elapsedSince: () => 0,
  logLatency: vi.fn(),
  startLatencyTimer: () => 0,
}));

describe("useCloudWorkspacePolling", () => {
  beforeEach(() => {
    mocks.refreshCloudWorkspace.mockReset();
    mocks.selectWorkspace.mockReset();
    mocks.materializePendingWorkspaceSessions.mockReset();
    mocks.trackWorkspaceInteraction.mockReset();
    mocks.notifyUnattendedPendingWorkspaceFailure.mockReset();
    mocks.materializePendingWorkspaceSessions.mockReturnValue({
      pendingWorkspaceUiKey: "pending-workspace:attempt-1",
      projectedSessionCount: 0,
      projectedSessionIds: [],
    });
    mocks.workspaceCollections.cloudWorkspaces = [cloudWorkspace({ status: "pending" })];
    useSessionDirectoryStore.getState().clearEntries();
    useSessionTranscriptStore.getState().clearEntries();
    useSessionSelectionStore.setState({
      pendingWorkspaces: EMPTY_PENDING_WORKSPACE_REGISTRY,
      selectedLogicalWorkspaceId: null,
      selectedWorkspaceId: null,
      workspaceSelectionNonce: 0,
      workspaceArrivalEvent: null,
      activeSessionId: null,
      activeSessionVersion: 0,
      sessionActivationIntentEpochByWorkspace: {},
      hotPaintGate: null,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("preserves the active projected session when a pending cloud workspace becomes ready", async () => {
    const workspaceId = "cloud:cloud-1";
    const projectedSessionId = "client-session:claude:1";
    const pendingEntry = {
      ...buildSubmittingPendingWorkspaceEntry({
        attemptId: "attempt-1",
        selectedWorkspaceId: null,
        source: "cloud-created",
        displayName: "feature-branch",
        repoLabel: "proliferate-ai/proliferate",
        baseBranchName: "main",
        request: {
          kind: "select-existing" as const,
          workspaceId,
        },
      }),
      stage: "awaiting-cloud-ready" as const,
      workspaceId,
    };
    const pendingWorkspaceUiKey = buildPendingWorkspaceUiKey(pendingEntry);
    putSessionRecord(createEmptySessionRecord(projectedSessionId, "claude", {
      workspaceId: pendingWorkspaceUiKey,
      materializedSessionId: null,
      modelId: "claude-sonnet-4.5",
      modeId: "default",
      sessionRelationship: { kind: "root" },
    }));
    useSessionSelectionStore.setState({
      pendingWorkspaces: upsertPendingWorkspaceEntry(
        EMPTY_PENDING_WORKSPACE_REGISTRY,
        pendingEntry,
      ),
      selectedWorkspaceId: workspaceId,
      activeSessionId: projectedSessionId,
    });
    mocks.refreshCloudWorkspace.mockResolvedValueOnce(cloudWorkspace({ status: "ready" }));
    mocks.selectWorkspace.mockResolvedValueOnce(undefined);
    mocks.materializePendingWorkspaceSessions.mockReturnValueOnce({
      pendingWorkspaceUiKey,
      projectedSessionCount: 1,
      projectedSessionIds: [projectedSessionId],
    });
    let pendingEntryAtInteraction: unknown = null;
    mocks.trackWorkspaceInteraction.mockImplementation(() => {
      pendingEntryAtInteraction = readPendingEntry();
    });

    renderHook(() => useCloudWorkspacePolling());

    await waitFor(() => {
      expect(mocks.selectWorkspace).toHaveBeenCalledWith(workspaceId, {
        force: true,
        preservePending: true,
        initialActiveSessionId: projectedSessionId,
      });
    });
    expect(mocks.materializePendingWorkspaceSessions).toHaveBeenCalledWith(
      pendingEntry,
      workspaceId,
      { eventPrefix: "workspace.cloud_polling", attended: true },
    );
    await waitFor(() => {
      expect(mocks.trackWorkspaceInteraction).toHaveBeenCalledWith(
        workspaceId,
        expect.any(String),
      );
    });
    expect(pendingEntryAtInteraction).toMatchObject({ attemptId: "attempt-1" });
    expect(readPendingEntry()).toBeNull();
  });

  it("marks the current awaiting cloud workspace as failed when polling returns error", async () => {
    const workspaceId = "cloud:cloud-1";
    const pendingEntry = {
      ...buildSubmittingPendingWorkspaceEntry({
        attemptId: "attempt-1",
        selectedWorkspaceId: null,
        source: "cloud-created",
        displayName: "feature-branch",
        repoLabel: "proliferate-ai/proliferate",
        baseBranchName: "main",
        request: {
          kind: "select-existing" as const,
          workspaceId,
        },
      }),
      stage: "awaiting-cloud-ready" as const,
      workspaceId,
    };
    useSessionSelectionStore.setState({
      pendingWorkspaces: upsertPendingWorkspaceEntry(
        EMPTY_PENDING_WORKSPACE_REGISTRY,
        pendingEntry,
      ),
      selectedWorkspaceId: workspaceId,
    });
    mocks.refreshCloudWorkspace.mockResolvedValueOnce(cloudWorkspace({
      status: "error",
      lastError: "Provisioning failed",
    }));

    renderHook(() => useCloudWorkspacePolling());

    await waitFor(() => {
      expect(readPendingEntry()).toMatchObject({
        stage: "failed",
        workspaceId,
        errorMessage: "Provisioning failed",
        request: { kind: "select-existing", workspaceId },
      });
    });
    expect(mocks.selectWorkspace).not.toHaveBeenCalled();
    expect(mocks.materializePendingWorkspaceSessions).not.toHaveBeenCalled();
  });

  it("finalizes an awaiting pending entry when the cached cloud workspace is already ready", async () => {
    const workspaceId = "cloud:cloud-1";
    const pendingEntry = {
      ...buildSubmittingPendingWorkspaceEntry({
        attemptId: "attempt-1",
        selectedWorkspaceId: null,
        source: "cloud-created",
        displayName: "feature-branch",
        repoLabel: "proliferate-ai/proliferate",
        baseBranchName: "main",
        request: {
          kind: "select-existing" as const,
          workspaceId,
        },
      }),
      stage: "awaiting-cloud-ready" as const,
      workspaceId,
    };
    mocks.workspaceCollections.cloudWorkspaces = [cloudWorkspace({ status: "ready" })];
    useSessionSelectionStore.setState({
      pendingWorkspaces: upsertPendingWorkspaceEntry(
        EMPTY_PENDING_WORKSPACE_REGISTRY,
        pendingEntry,
      ),
      selectedWorkspaceId: workspaceId,
    });
    mocks.refreshCloudWorkspace.mockResolvedValueOnce(cloudWorkspace({ status: "ready" }));
    mocks.selectWorkspace.mockResolvedValueOnce(undefined);
    mocks.materializePendingWorkspaceSessions.mockReturnValueOnce({
      pendingWorkspaceUiKey: buildPendingWorkspaceUiKey(pendingEntry),
      projectedSessionCount: 0,
      projectedSessionIds: [],
    });

    renderHook(() => useCloudWorkspacePolling());

    await waitFor(() => {
      expect(mocks.refreshCloudWorkspace).toHaveBeenCalledWith(workspaceId);
    });
    await waitFor(() => {
      expect(mocks.selectWorkspace).toHaveBeenCalledWith(workspaceId, {
        force: true,
        preservePending: true,
      });
    });
    expect(mocks.materializePendingWorkspaceSessions).toHaveBeenCalledWith(
      pendingEntry,
      workspaceId,
      { eventPrefix: "workspace.cloud_polling", attended: true },
    );
    expect(readPendingEntry()).toBeNull();
  });

  it("marks the current awaiting cloud workspace as failed when the cached cloud workspace is already error", async () => {
    const workspaceId = "cloud:cloud-1";
    const pendingEntry = {
      ...buildSubmittingPendingWorkspaceEntry({
        attemptId: "attempt-1",
        selectedWorkspaceId: null,
        source: "cloud-created",
        displayName: "feature-branch",
        repoLabel: "proliferate-ai/proliferate",
        baseBranchName: "main",
        request: {
          kind: "select-existing" as const,
          workspaceId,
        },
      }),
      stage: "awaiting-cloud-ready" as const,
      workspaceId,
    };
    mocks.workspaceCollections.cloudWorkspaces = [cloudWorkspace({
      status: "error",
      lastError: "Provisioning failed before poll",
    })];
    useSessionSelectionStore.setState({
      pendingWorkspaces: upsertPendingWorkspaceEntry(
        EMPTY_PENDING_WORKSPACE_REGISTRY,
        pendingEntry,
      ),
      selectedWorkspaceId: workspaceId,
    });

    renderHook(() => useCloudWorkspacePolling());

    await waitFor(() => {
      expect(readPendingEntry()).toMatchObject({
        stage: "failed",
        workspaceId,
        errorMessage: "Provisioning failed before poll",
        request: { kind: "select-existing", workspaceId },
      });
    });
    expect(mocks.refreshCloudWorkspace).not.toHaveBeenCalled();
    expect(mocks.selectWorkspace).not.toHaveBeenCalled();
    expect(mocks.materializePendingWorkspaceSessions).not.toHaveBeenCalled();
  });

  it("finalizes an unattended awaiting entry without moving selection", async () => {
    const workspaceId = "cloud:cloud-1";
    const pendingEntry = awaitingEntry("attempt-1", workspaceId);
    seedRegistry([pendingEntry]);
    useSessionSelectionStore.setState({
      selectedWorkspaceId: "cloud:other",
      selectedLogicalWorkspaceId: "cloud:other",
      activeSessionId: "session-in-other-workspace",
    });
    mocks.refreshCloudWorkspace.mockResolvedValue(cloudWorkspace({ status: "ready" }));

    renderHook(() => useCloudWorkspacePolling());

    await waitFor(() => {
      expect(readPendingEntry()).toBeNull();
    });
    expect(mocks.refreshCloudWorkspace).toHaveBeenCalledWith(workspaceId);
    expect(mocks.selectWorkspace).not.toHaveBeenCalled();
    expect(mocks.materializePendingWorkspaceSessions).toHaveBeenCalledWith(
      pendingEntry,
      workspaceId,
      { eventPrefix: "workspace.cloud_polling", attended: false },
    );
    const selection = useSessionSelectionStore.getState();
    expect(selection.selectedWorkspaceId).toBe("cloud:other");
    expect(selection.activeSessionId).toBe("session-in-other-workspace");
    expect(selection.workspaceArrivalEvent).toBeNull();
  });

  it("polls every awaiting entry, not just the selected one", async () => {
    mocks.workspaceCollections.cloudWorkspaces = [
      cloudWorkspace({ status: "pending" }),
      cloudWorkspace({ id: "cloud-2", status: "pending" }),
    ];
    seedRegistry([
      awaitingEntry("attempt-1", "cloud:cloud-1"),
      awaitingEntry("attempt-2", "cloud:cloud-2"),
    ]);
    mocks.refreshCloudWorkspace.mockResolvedValue(cloudWorkspace({ status: "pending" }));

    renderHook(() => useCloudWorkspacePolling());

    await waitFor(() => {
      expect(mocks.refreshCloudWorkspace).toHaveBeenCalledWith("cloud:cloud-1");
      expect(mocks.refreshCloudWorkspace).toHaveBeenCalledWith("cloud:cloud-2");
    });
  });

  it("polls at most three workspaces per tick", async () => {
    const workspaceIds = ["cloud-1", "cloud-2", "cloud-3", "cloud-4"];
    mocks.workspaceCollections.cloudWorkspaces = workspaceIds.map((id) =>
      cloudWorkspace({ id, status: "pending" })
    );
    seedRegistry(workspaceIds.map((id, index) =>
      awaitingEntry(`attempt-${index + 1}`, `cloud:${id}`)
    ));
    mocks.refreshCloudWorkspace.mockResolvedValue(cloudWorkspace({ status: "pending" }));

    renderHook(() => useCloudWorkspacePolling());

    await waitFor(() => {
      expect(mocks.refreshCloudWorkspace).toHaveBeenCalledTimes(3);
    });
    expect(mocks.refreshCloudWorkspace.mock.calls.map(([id]) => id)).toEqual([
      "cloud:cloud-1",
      "cloud:cloud-2",
      "cloud:cloud-3",
    ]);
  });

  it("stops polling an entry once it leaves the awaiting state", async () => {
    vi.useFakeTimers();
    try {
      mocks.workspaceCollections.cloudWorkspaces = [
        cloudWorkspace({ status: "pending" }),
        cloudWorkspace({ id: "cloud-2", status: "pending" }),
      ];
      seedRegistry([
        awaitingEntry("attempt-1", "cloud:cloud-1"),
        awaitingEntry("attempt-2", "cloud:cloud-2"),
      ]);
      mocks.refreshCloudWorkspace.mockImplementation(async (workspaceId: string) =>
        workspaceId === "cloud:cloud-1"
          ? cloudWorkspace({ status: "ready" })
          : cloudWorkspace({ id: "cloud-2", status: "pending" })
      );

      renderHook(() => useCloudWorkspacePolling());

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(readPendingEntry()).toBeNull();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(9000);
      });
      const polledWorkspaceIds = mocks.refreshCloudWorkspace.mock.calls.map(([id]) => id);
      expect(polledWorkspaceIds.filter((id) => id === "cloud:cloud-1")).toHaveLength(1);
      expect(polledWorkspaceIds.filter((id) => id === "cloud:cloud-2").length).toBeGreaterThan(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("marks an unattended awaiting entry failed and announces it when readiness fails", async () => {
    const workspaceId = "cloud:cloud-1";
    const pendingEntry = awaitingEntry("attempt-1", workspaceId);
    seedRegistry([pendingEntry]);
    useSessionSelectionStore.setState({
      selectedWorkspaceId: "cloud:other",
      selectedLogicalWorkspaceId: "cloud:other",
    });
    mocks.refreshCloudWorkspace.mockResolvedValue(cloudWorkspace({
      status: "error",
      lastError: "Provisioning timed out",
    }));

    renderHook(() => useCloudWorkspacePolling());

    await waitFor(() => {
      expect(readPendingEntry()).toMatchObject({
        stage: "failed",
        workspaceId,
        errorMessage: "Provisioning timed out",
        request: { kind: "select-existing", workspaceId },
      });
    });
    expect(mocks.notifyUnattendedPendingWorkspaceFailure).toHaveBeenCalledWith(
      expect.objectContaining({ attemptId: "attempt-1" }),
      "Provisioning timed out",
    );
    expect(mocks.selectWorkspace).not.toHaveBeenCalled();
  });
});

function awaitingEntry(attemptId: string, workspaceId: string) {
  return {
    ...buildSubmittingPendingWorkspaceEntry({
      attemptId,
      selectedWorkspaceId: null,
      source: "cloud-created",
      displayName: "feature-branch",
      repoLabel: "proliferate-ai/proliferate",
      baseBranchName: "main",
      request: { kind: "select-existing" as const, workspaceId },
    }),
    stage: "awaiting-cloud-ready" as const,
    workspaceId,
  };
}

function seedRegistry(entries: readonly PendingWorkspaceEntry[]) {
  useSessionSelectionStore.setState({
    pendingWorkspaces: entries.reduce(
      (registry, entry) => upsertPendingWorkspaceEntry(registry, entry),
      EMPTY_PENDING_WORKSPACE_REGISTRY,
    ),
  });
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
    statusDetail: input.statusDetail ?? null,
    lastError: input.lastError ?? null,
    templateVersion: null,
    updatedAt: null,
    createdAt: null,
    readyAt: "readyAt" in input
      ? input.readyAt ?? null
      : input.status === "ready"
        ? "2026-04-14T00:00:00Z"
        : null,
    postReadyPhase: "",
    postReadyFilesTotal: 0,
    postReadyFilesApplied: 0,
    postReadyStartedAt: null,
    postReadyCompletedAt: null,
    visibility: "private",
  };
}

function readPendingEntry() {
  return pendingWorkspaceEntry(
    useSessionSelectionStore.getState().pendingWorkspaces,
    "attempt-1",
  );
}
