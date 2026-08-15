// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CloudWorkspaceSummary } from "#product/lib/domain/workspaces/cloud/cloud-workspace-model";
import {
  buildPendingWorkspaceUiKey,
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
import { useCloudWorkspacePolling } from "#product/hooks/workspaces/lifecycle/use-cloud-workspace-polling";
import {
  awaitingCloudWorkspaceEntryFixture as awaitingEntry,
  cloudWorkspaceFixture as cloudWorkspace,
} from "#product/test/cloud-workspace-fixtures";

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
  // A fresh callback identity per render, exactly like the real hook: its
  // identity chains through the collections cache that every successful poll
  // invalidates. The loop must not restart on that churn (review finding 2).
  useCloudWorkspaceActions: () => ({
    refreshCloudWorkspace: (workspaceId: string) => mocks.refreshCloudWorkspace(workspaceId),
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
    const pendingEntry = awaitingEntry("attempt-1", workspaceId);
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
    const pendingEntry = awaitingEntry("attempt-1", workspaceId);
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
    const pendingEntry = awaitingEntry("attempt-1", workspaceId);
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
    const pendingEntry = awaitingEntry("attempt-1", workspaceId);
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

  it("keeps one tick per interval while the poll's own writes churn its callbacks", async () => {
    vi.useFakeTimers();
    try {
      seedRegistry([awaitingEntry("attempt-1", "cloud:cloud-1")]);
      mocks.refreshCloudWorkspace.mockResolvedValue(cloudWorkspace({ status: "pending" }));

      const { rerender } = renderHook(() => useCloudWorkspacePolling());

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(mocks.refreshCloudWorkspace).toHaveBeenCalledTimes(1);

      // Five renders' worth of churn inside one interval — each one hands the
      // hook a new `refreshCloudWorkspace` identity, as an invalidated
      // collections query does. None of them may buy an extra refresh.
      for (let renderPass = 0; renderPass < 5; renderPass += 1) {
        rerender();
        await act(async () => {
          await vi.advanceTimersByTimeAsync(500);
        });
      }
      expect(mocks.refreshCloudWorkspace).toHaveBeenCalledTimes(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(600);
      });
      expect(mocks.refreshCloudWorkspace).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("spaces the first tick after an attempt joins the set", async () => {
    vi.useFakeTimers();
    try {
      seedRegistry([awaitingEntry("attempt-1", "cloud:cloud-1")]);
      mocks.workspaceCollections.cloudWorkspaces = [
        cloudWorkspace({ status: "pending" }),
        cloudWorkspace({ id: "cloud-2", status: "pending" }),
      ];
      mocks.refreshCloudWorkspace.mockResolvedValue(cloudWorkspace({ status: "pending" }));

      const { rerender } = renderHook(() => useCloudWorkspacePolling());

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(mocks.refreshCloudWorkspace).toHaveBeenCalledTimes(1);

      // A second launch restarts the interval. The restart re-schedules against
      // the last tick rather than firing one immediately, so the interval stays
      // the floor no matter how often the set changes.
      await act(async () => {
        seedRegistry([
          awaitingEntry("attempt-1", "cloud:cloud-1"),
          awaitingEntry("attempt-2", "cloud:cloud-2"),
        ]);
        await vi.advanceTimersByTimeAsync(500);
      });
      rerender();
      expect(mocks.refreshCloudWorkspace).toHaveBeenCalledTimes(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2600);
      });
      expect(mocks.refreshCloudWorkspace.mock.calls.map(([id]) => id)).toEqual([
        "cloud:cloud-1",
        "cloud:cloud-1",
        "cloud:cloud-2",
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails an awaiting entry whose cloud workspace reached a terminal status", async () => {
    const workspaceId = "cloud:cloud-1";
    seedRegistry([awaitingEntry("attempt-1", workspaceId)]);
    useSessionSelectionStore.setState({
      selectedWorkspaceId: "cloud:other",
      selectedLogicalWorkspaceId: "cloud:other",
    });
    mocks.workspaceCollections.cloudWorkspaces = [cloudWorkspace({ status: "lost" })];

    renderHook(() => useCloudWorkspacePolling());

    await waitFor(() => {
      expect(readPendingEntry()).toMatchObject({
        stage: "failed",
        workspaceId,
        errorMessage: "Cloud workspace was lost before it became ready.",
        request: { kind: "select-existing", workspaceId },
      });
    });
    // Terminal means terminal: no round trip, and the attempt stops occupying a
    // rotation slot instead of waiting out the staleness timer.
    expect(mocks.refreshCloudWorkspace).not.toHaveBeenCalled();
    expect(mocks.notifyUnattendedPendingWorkspaceFailure).toHaveBeenCalledWith(
      expect.objectContaining({ attemptId: "attempt-1" }),
      "Cloud workspace was lost before it became ready.",
    );
  });

  it("fails an awaiting entry when a refresh reports a terminal status", async () => {
    const workspaceId = "cloud:cloud-1";
    seedRegistry([awaitingEntry("attempt-1", workspaceId)]);
    mocks.refreshCloudWorkspace.mockResolvedValue(cloudWorkspace({ status: "archived" }));

    renderHook(() => useCloudWorkspacePolling());

    await waitFor(() => {
      expect(readPendingEntry()).toMatchObject({
        stage: "failed",
        workspaceId,
        errorMessage: "Cloud workspace was archived before it became ready.",
      });
    });
    expect(mocks.materializePendingWorkspaceSessions).not.toHaveBeenCalled();
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

function seedRegistry(entries: readonly PendingWorkspaceEntry[]) {
  useSessionSelectionStore.setState({
    pendingWorkspaces: entries.reduce(
      (registry, entry) => upsertPendingWorkspaceEntry(registry, entry),
      EMPTY_PENDING_WORKSPACE_REGISTRY,
    ),
  });
}

function readPendingEntry() {
  return pendingWorkspaceEntry(
    useSessionSelectionStore.getState().pendingWorkspaces,
    "attempt-1",
  );
}
