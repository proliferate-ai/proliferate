// @vitest-environment jsdom

import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSelectedCloudRuntimeRehydration } from "#product/hooks/workspaces/lifecycle/use-selected-cloud-runtime-rehydration";
import type { SelectedCloudRuntimeState } from "#product/hooks/workspaces/facade/use-selected-cloud-runtime-state";
import {
  createEmptySessionRecord,
  putSessionRecord,
} from "#product/stores/sessions/session-records";
import { useSessionDirectoryStore } from "#product/stores/sessions/session-directory-store";
import { useSessionTranscriptStore } from "#product/stores/sessions/session-transcript-store";
import { useSessionSelectionStore } from "#product/stores/sessions/session-selection-store";

const mocks = vi.hoisted(() => ({
  bootstrapWorkspace: vi.fn(),
  materializePendingWorkspaceSessions: vi.fn(),
  materializeReadyWorkspaceProjectedSessions: vi.fn(),
  withFreshCloudSandboxGatewayAccessToken: vi.fn(async <T,>(connectionInfo: T) => connectionInfo),
}));

vi.mock("#product/hooks/workspaces/workflows/use-workspace-bootstrap-actions", () => ({
  useWorkspaceBootstrapActions: () => ({
    bootstrapWorkspace: mocks.bootstrapWorkspace,
  }),
}));

vi.mock("#product/hooks/workspaces/workflows/use-pending-workspace-session-materialization", () => ({
  usePendingWorkspaceSessionMaterialization: () =>
    mocks.materializePendingWorkspaceSessions,
  useReadyWorkspaceProjectedSessionMaterialization: () =>
    mocks.materializeReadyWorkspaceProjectedSessions,
}));

vi.mock("#product/hooks/workspaces/lifecycle/workspace-bootstrap-memory", () => ({
  hasWorkspaceBootstrappedInSession: () => true,
}));

vi.mock("#product/lib/access/cloud/cloud-sandbox-gateway", () => ({
  withFreshCloudSandboxGatewayAccessToken:
    mocks.withFreshCloudSandboxGatewayAccessToken,
}));

vi.mock("#product/lib/infra/measurement/measurement-port", () => ({
  logLatency: vi.fn(),
  startLatencyTimer: vi.fn(() => 0),
}));

describe("useSelectedCloudRuntimeRehydration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSessionDirectoryStore.getState().clearEntries();
    useSessionTranscriptStore.getState().clearEntries();
    useSessionSelectionStore.getState().clearSelection();
  });

  afterEach(() => {
    cleanup();
  });

  it("recovers an unmaterialized projected root session in an already-ready workspace", async () => {
    useSessionSelectionStore.setState({
      selectedLogicalWorkspaceId: "cloud:workspace-real",
      selectedWorkspaceId: "workspace-real",
      pendingWorkspaceEntry: null,
      activeSessionId: "client-session:claude:1",
    });
    putSessionRecord({
      ...createEmptySessionRecord("client-session:claude:1", "claude", {
        workspaceId: "workspace-real",
        materializedSessionId: null,
        modelId: "opus",
        requestedModelId: "opus",
        sessionRelationship: { kind: "root" },
      }),
      status: "errored",
      transcriptHydrated: true,
    });

    renderHook(() => useSelectedCloudRuntimeRehydration(readyCloudRuntime()));

    await waitFor(() => {
      expect(mocks.materializeReadyWorkspaceProjectedSessions).toHaveBeenCalledWith(
        "workspace-real",
        { eventPrefix: "workspace.cloud_runtime_rehydration" },
      );
    });
    expect(mocks.bootstrapWorkspace).not.toHaveBeenCalled();
    expect(mocks.materializePendingWorkspaceSessions).not.toHaveBeenCalled();
  });
});

function readyCloudRuntime(): SelectedCloudRuntimeState {
  return {
    workspaceId: "workspace-real",
    cloudWorkspaceId: "workspace-real",
    state: {
      phase: "ready",
      variant: "warm",
      tone: "pending",
      title: null,
      subtitle: null,
      actionBlockReason: null,
      preserveVisibleContent: false,
      showRetry: false,
      showClaim: false,
    },
    connectionInfo: {
      runtimeUrl: "https://runtime.invalid",
      accessToken: "test-token",
      anyharnessWorkspaceId: "anyharness-workspace-1",
    } as SelectedCloudRuntimeState["connectionInfo"],
    retry: null,
    claim: null,
    claimPending: false,
  };
}
