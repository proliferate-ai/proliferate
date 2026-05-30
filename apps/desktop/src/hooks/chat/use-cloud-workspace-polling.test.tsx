// @vitest-environment jsdom

import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CloudWorkspaceSummary } from "@/lib/domain/workspaces/cloud/cloud-workspace-model";
import {
  buildPendingWorkspaceUiKey,
  buildSubmittingPendingWorkspaceEntry,
} from "@/lib/domain/workspaces/creation/pending-entry";
import {
  createEmptySessionRecord,
  putSessionRecord,
} from "@/stores/sessions/session-records";
import { useSessionDirectoryStore } from "@/stores/sessions/session-directory-store";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useSessionTranscriptStore } from "@/stores/sessions/session-transcript-store";
import { useCloudWorkspacePolling } from "./use-cloud-workspace-polling";

const mocks = vi.hoisted(() => ({
  refreshCloudWorkspace: vi.fn(),
  selectWorkspace: vi.fn(),
  materializePendingWorkspaceSessions: vi.fn(),
  workspaceCollections: {
    cloudWorkspaces: [] as CloudWorkspaceSummary[],
  },
}));

vi.mock("@/hooks/workspaces/cache/use-workspaces", () => ({
  useWorkspaces: () => ({
    data: mocks.workspaceCollections,
  }),
}));

vi.mock("@/hooks/cloud/workflows/use-cloud-workspace-actions", () => ({
  useCloudWorkspaceActions: () => ({
    refreshCloudWorkspace: mocks.refreshCloudWorkspace,
  }),
}));

vi.mock("@/hooks/workspaces/selection/use-workspace-selection", () => ({
  useWorkspaceSelection: () => ({
    selectWorkspace: mocks.selectWorkspace,
  }),
}));

vi.mock("@/hooks/workspaces/workflows/use-pending-workspace-session-materialization", () => ({
  usePendingWorkspaceSessionMaterialization: () => mocks.materializePendingWorkspaceSessions,
}));

vi.mock("@/lib/infra/measurement/debug-latency", () => ({
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
    mocks.workspaceCollections.cloudWorkspaces = [cloudWorkspace({ status: "pending" })];
    useSessionDirectoryStore.getState().clearEntries();
    useSessionTranscriptStore.getState().clearEntries();
    useSessionSelectionStore.setState({
      pendingWorkspaceEntry: null,
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
      pendingWorkspaceEntry: pendingEntry,
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
      { eventPrefix: "workspace.cloud_polling" },
    );
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
      pendingWorkspaceEntry: pendingEntry,
      selectedWorkspaceId: workspaceId,
    });
    mocks.refreshCloudWorkspace.mockResolvedValueOnce(cloudWorkspace({
      status: "error",
      lastError: "Provisioning failed",
    }));

    renderHook(() => useCloudWorkspacePolling());

    await waitFor(() => {
      expect(useSessionSelectionStore.getState().pendingWorkspaceEntry).toMatchObject({
        stage: "failed",
        workspaceId,
        errorMessage: "Provisioning failed",
        request: { kind: "select-existing", workspaceId },
      });
    });
    expect(mocks.selectWorkspace).not.toHaveBeenCalled();
    expect(mocks.materializePendingWorkspaceSessions).not.toHaveBeenCalled();
  });
});

function cloudWorkspace(
  input: Partial<CloudWorkspaceSummary> & {
    status: CloudWorkspaceSummary["status"];
  },
): CloudWorkspaceSummary {
  return {
    id: "cloud-1",
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
    actionBlockKind: null,
    actionBlockReason: null,
    postReadyPhase: "",
    postReadyFilesTotal: 0,
    postReadyFilesApplied: 0,
    postReadyStartedAt: null,
    postReadyCompletedAt: null,
    visibility: "private",
  };
}
