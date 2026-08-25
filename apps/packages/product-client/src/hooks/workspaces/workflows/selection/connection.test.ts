import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  DesktopRuntimeBridge,
} from "@proliferate/product-client/host/desktop-bridge";

import { useHarnessConnectionStore } from "#product/stores/sessions/harness-connection-store";
import type {
  WorkspaceSelectionContext,
  WorkspaceSelectionDeps,
} from "#product/hooks/workspaces/workflows/selection/types";

const mocks = vi.hoisted(() => ({
  ensureRuntimeReady: vi.fn(),
  resolveWorkspaceConnection: vi.fn(),
}));

vi.mock("#product/hooks/workspaces/workflows/runtime-ready", () => ({
  ensureRuntimeReady: mocks.ensureRuntimeReady,
}));
vi.mock("#product/lib/access/anyharness/resolve-workspace-connection", () => ({
  resolveWorkspaceConnection: mocks.resolveWorkspaceConnection,
}));

import { resolveSelectionConnection } from "#product/hooks/workspaces/workflows/selection/connection";

const context = (workspaceId: string): WorkspaceSelectionContext => ({
  workspaceId,
  logicalWorkspaceId: `logical:${workspaceId}`,
  selectionNonce: 1,
  selectionStartedAt: 1,
  cloudWorkspaceId: null,
  abortSignal: new AbortController().signal,
});

function deps(
  localRuntime: DesktopRuntimeBridge | null,
  refreshCloudWorkspaceConnection = vi.fn(),
): WorkspaceSelectionDeps {
  return {
    localRuntime,
    cloudClient: null,
    logicalWorkspaces: [],
    rawWorkspaces: [],
    cache: {
      cancelPreviousWorkspaceDisplayQueries: vi.fn(),
      invalidateCloudWorkspaceStartState: vi.fn(),
      refreshCloudWorkspaceConnection,
    },
    setSelectedLogicalWorkspaceId: vi.fn(),
    setSelectedWorkspace: vi.fn(),
    removeWorkspaceSlots: vi.fn(),
    clearSelection: vi.fn(),
    bootstrapWorkspace: vi.fn(),
    reconcileHotWorkspace: vi.fn(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useHarnessConnectionStore.setState({
    runtimeUrl: "",
    connectionState: "connecting",
    error: null,
  });
});

describe("resolveSelectionConnection", () => {
  it("uses the injected Desktop runtime for a local workspace", async () => {
    const runtime = {
      getConnection: vi.fn(),
      restart: vi.fn(),
    } satisfies DesktopRuntimeBridge;
    mocks.ensureRuntimeReady.mockResolvedValue("http://runtime.test");
    mocks.resolveWorkspaceConnection.mockResolvedValue({
      connection: {
        runtimeUrl: "http://runtime.test",
        anyharnessWorkspaceId: "workspace-runtime",
        runtimeGeneration: 0,
        runtimeAccessKind: "direct",
      },
      filesystemOrigin: "desktop-local",
    });

    const result = await resolveSelectionConnection(
      deps(runtime),
      context("workspace-local"),
      { kind: "local", runtimeWorkspaceId: "workspace-runtime" },
    );

    expect(mocks.ensureRuntimeReady).toHaveBeenCalledWith(runtime);
    expect(mocks.resolveWorkspaceConnection).toHaveBeenCalledWith(
      "http://runtime.test",
      "workspace-runtime",
      null,
    );
    expect(result.runtimeUrl).toBe("http://runtime.test");
    expect(result.workspaceConnection).toEqual({
      runtimeUrl: "http://runtime.test",
      anyharnessWorkspaceId: "workspace-runtime",
      runtimeGeneration: 0,
      runtimeAccessKind: "direct",
    });
  });

  it("does not discover a local runtime for a Cloud workspace", async () => {
    const refreshCloudWorkspaceConnection = vi.fn().mockResolvedValue({
      runtimeUrl: "https://cloud.test",
      accessToken: "cloud-token",
      anyharnessWorkspaceId: "workspace-runtime",
      runtimeGeneration: 8,
      webSocketAuthTransport: "protocol",
    });

    const result = await resolveSelectionConnection(
      deps(null, refreshCloudWorkspaceConnection),
      { ...context("cloud:cloud-1"), cloudWorkspaceId: "cloud-1" },
      { kind: "cloud-ready", cloudWorkspaceId: "cloud-1" },
    );

    expect(mocks.ensureRuntimeReady).not.toHaveBeenCalled();
    expect(mocks.resolveWorkspaceConnection).not.toHaveBeenCalled();
    expect(result.workspaceConnection).toMatchObject({
      runtimeUrl: "https://cloud.test",
      authToken: "cloud-token",
      anyharnessWorkspaceId: "workspace-runtime",
      runtimeGeneration: 8,
      runtimeAccessKind: "proliferate-gateway",
      webSocketAuthTransport: "protocol",
    });
  });
});
