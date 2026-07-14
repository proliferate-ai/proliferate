import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  DesktopRuntimeBridge,
  DesktopSshBridge,
} from "@proliferate/product-client/host/desktop-bridge";

import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";
import type {
  WorkspaceSelectionContext,
  WorkspaceSelectionDeps,
} from "./types";

const mocks = vi.hoisted(() => ({
  ensureRuntimeReady: vi.fn(),
  resolveWorkspaceConnection: vi.fn(),
}));

vi.mock("@/hooks/workspaces/workflows/runtime-ready", () => ({
  ensureRuntimeReady: mocks.ensureRuntimeReady,
}));
vi.mock("@/lib/access/anyharness/resolve-workspace-connection", () => ({
  resolveWorkspaceConnection: mocks.resolveWorkspaceConnection,
}));

import { resolveSelectionConnection } from "./connection";

const context = (workspaceId: string): WorkspaceSelectionContext => ({
  workspaceId,
  logicalWorkspaceId: `logical:${workspaceId}`,
  selectionNonce: 1,
  selectionStartedAt: 1,
  cloudWorkspaceId: null,
});

function deps(
  localRuntime: DesktopRuntimeBridge | null,
  refreshCloudWorkspaceConnection = vi.fn(),
  ssh: DesktopSshBridge | null = null,
): WorkspaceSelectionDeps {
  return {
    localRuntime,
    ssh,
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
      runtimeUrl: "http://runtime.test",
      anyharnessWorkspaceId: "workspace-runtime",
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
      null,
    );
    expect(result.runtimeUrl).toBe("http://runtime.test");
  });

  it("does not discover a local runtime for an SSH target workspace", async () => {
    const ssh = {
      getProfile: vi.fn(),
      saveProfile: vi.fn(),
      removeProfile: vi.fn(),
      ensureTunnel: vi.fn(),
    } satisfies DesktopSshBridge;
    mocks.resolveWorkspaceConnection.mockResolvedValue({
      runtimeUrl: "https://target.test",
      anyharnessWorkspaceId: "workspace-runtime",
    });

    await resolveSelectionConnection(
      deps(null, vi.fn(), ssh),
      context("target:target-1:workspace-runtime"),
      { kind: "local" },
    );

    expect(mocks.ensureRuntimeReady).not.toHaveBeenCalled();
    expect(mocks.resolveWorkspaceConnection).toHaveBeenCalledWith(
      "",
      "target:target-1:workspace-runtime",
      ssh,
      null,
    );
  });

  it("does not discover a local runtime for a Cloud workspace", async () => {
    const refreshCloudWorkspaceConnection = vi.fn().mockResolvedValue({
      runtimeUrl: "https://cloud.test",
      accessToken: "cloud-token",
      anyharnessWorkspaceId: "workspace-runtime",
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
    });
  });
});
