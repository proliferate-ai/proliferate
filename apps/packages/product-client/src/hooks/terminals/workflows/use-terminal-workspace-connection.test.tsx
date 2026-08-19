// @vitest-environment jsdom

import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  selectedCloudRuntime: {
    workspaceId: null as string | null,
    state: null as { phase: string } | null,
    connectionInfo: null as Record<string, unknown> | null,
  },
  resolveWorkspaceConnection: vi.fn(),
  invalidateCloudWorkspaceConnection: vi.fn(),
  getWorkspaceRuntimeBlockReason: vi.fn(),
  withFreshCloudSandboxGatewayAccessToken: vi.fn(async (connection: unknown) => connection),
}));

vi.mock("@proliferate/product-client/host/ProductHostProvider", () => ({
  useProductHost: () => ({ desktop: null, cloud: { client: null } }),
}));

vi.mock("#product/hooks/access/cloud/use-cloud-workspace-connection-cache", () => ({
  useCloudWorkspaceConnectionCache: () => ({
    invalidateCloudWorkspaceConnection: mocks.invalidateCloudWorkspaceConnection,
  }),
}));

vi.mock("#product/hooks/workspaces/derived/use-workspace-runtime-block", () => ({
  useWorkspaceRuntimeBlock: () => ({
    selectedCloudRuntime: mocks.selectedCloudRuntime,
    getWorkspaceRuntimeBlockReason: mocks.getWorkspaceRuntimeBlockReason,
  }),
}));

vi.mock("#product/lib/access/anyharness/resolve-workspace-connection", () => ({
  resolveWorkspaceConnection: mocks.resolveWorkspaceConnection,
}));

vi.mock("#product/lib/access/cloud/cloud-sandbox-gateway", async (importOriginal) => {
  const original = await importOriginal<
    typeof import("#product/lib/access/cloud/cloud-sandbox-gateway")
  >();
  return {
    ...original,
    withFreshCloudSandboxGatewayAccessToken:
      mocks.withFreshCloudSandboxGatewayAccessToken,
  };
});

import { useTerminalWorkspaceConnection } from "#product/hooks/terminals/workflows/use-terminal-workspace-connection";
import { useHarnessConnectionStore } from "#product/stores/sessions/harness-connection-store";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.selectedCloudRuntime.workspaceId = null;
  mocks.selectedCloudRuntime.state = null;
  mocks.selectedCloudRuntime.connectionInfo = null;
  useHarnessConnectionStore.setState({
    runtimeUrl: "http://local.runtime.test",
    connectionState: "healthy",
    error: null,
  });
});

afterEach(() => {
  cleanup();
});

describe("useTerminalWorkspaceConnection", () => {
  it("preserves all cached Cloud gateway connection metadata", async () => {
    mocks.selectedCloudRuntime.workspaceId = "cloud:cloud-1";
    mocks.selectedCloudRuntime.state = { phase: "ready" };
    mocks.selectedCloudRuntime.connectionInfo = {
      runtimeUrl: "https://gateway.runtime.test",
      accessToken: "cloud-token",
      anyharnessWorkspaceId: "runtime-workspace",
      runtimeGeneration: 12,
      runtimeAccessKind: "proliferate-gateway",
      webSocketAuthTransport: "protocol",
    };
    const { result } = renderHook(() => useTerminalWorkspaceConnection());

    await expect(result.current.resolveTerminalWorkspaceConnection("cloud:cloud-1"))
      .resolves.toEqual({
        runtimeUrl: "https://gateway.runtime.test",
        authToken: "cloud-token",
        anyharnessWorkspaceId: "runtime-workspace",
        runtimeGeneration: 12,
        runtimeAccessKind: "proliferate-gateway",
        webSocketAuthTransport: "protocol",
      });
    expect(mocks.resolveWorkspaceConnection).not.toHaveBeenCalled();
  });

  it("unwraps the Product envelope on the normal terminal path", async () => {
    const connection = {
      runtimeUrl: "http://local.runtime.test",
      anyharnessWorkspaceId: "workspace-local",
      runtimeGeneration: 0,
      runtimeAccessKind: "direct" as const,
    };
    mocks.resolveWorkspaceConnection.mockResolvedValue({
      connection,
      filesystemOrigin: "desktop-local",
    });
    const { result } = renderHook(() => useTerminalWorkspaceConnection());

    await expect(result.current.resolveTerminalWorkspaceConnection("workspace-local"))
      .resolves.toEqual(connection);
  });
});
