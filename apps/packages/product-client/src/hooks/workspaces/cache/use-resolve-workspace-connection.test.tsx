// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveWorkspaceConnection: vi.fn(),
  withFreshCloudSandboxGatewayAccessToken: vi.fn(async (connection: unknown) => connection),
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

import { useResolveWorkspaceConnection } from "#product/hooks/workspaces/cache/use-resolve-workspace-connection";

function wrapper(queryClient: QueryClient) {
  return function QueryWrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

const input = {
  cloudClient: null,
  runtimeUrl: "http://local.runtime.test",
  authStatus: "anonymous",
  authUserId: null,
  cacheScopeKey: "test-scope",
  selectedWorkspaceId: null,
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("useResolveWorkspaceConnection", () => {
  it("returns the Product envelope from the normal resolver unchanged", async () => {
    const queryClient = new QueryClient();
    const expected = {
      connection: {
        runtimeUrl: "http://local.runtime.test",
        anyharnessWorkspaceId: "workspace-local",
        runtimeGeneration: 4,
        runtimeAccessKind: "direct" as const,
      },
      filesystemOrigin: "desktop-local" as const,
    };
    mocks.resolveWorkspaceConnection.mockResolvedValue(expected);
    const { result } = renderHook(
      () => useResolveWorkspaceConnection(input),
      { wrapper: wrapper(queryClient) },
    );

    await expect(result.current("workspace-local")).resolves.toEqual(expected);
    expect(mocks.resolveWorkspaceConnection).toHaveBeenCalledWith(
      "http://local.runtime.test",
      "workspace-local",
      null,
    );
  });

  it("treats only a successful cached Cloud gateway resolution as remote authority", async () => {
    const queryClient = new QueryClient();
    vi.spyOn(queryClient, "fetchQuery").mockResolvedValue({
      runtimeUrl: "https://gateway.runtime.test",
      accessToken: "cloud-token",
      anyharnessWorkspaceId: "runtime-workspace",
      runtimeGeneration: 9,
      webSocketAuthTransport: "protocol",
    });
    const { result } = renderHook(
      () => useResolveWorkspaceConnection(input),
      { wrapper: wrapper(queryClient) },
    );

    await expect(result.current("cloud:cloud-1")).resolves.toEqual({
      connection: {
        runtimeUrl: "https://gateway.runtime.test",
        authToken: "cloud-token",
        anyharnessWorkspaceId: "runtime-workspace",
        runtimeGeneration: 9,
        runtimeAccessKind: "proliferate-gateway",
        webSocketAuthTransport: "protocol",
      },
      filesystemOrigin: "remote",
    });
    expect(mocks.resolveWorkspaceConnection).not.toHaveBeenCalled();
  });

  it("rejects a failed cached Cloud fetch instead of synthesizing provenance", async () => {
    const queryClient = new QueryClient();
    vi.spyOn(queryClient, "fetchQuery").mockRejectedValue(new Error("connection unavailable"));
    const { result } = renderHook(
      () => useResolveWorkspaceConnection(input),
      { wrapper: wrapper(queryClient) },
    );

    await expect(result.current("cloud:cloud-1")).rejects.toThrow("connection unavailable");
    expect(mocks.resolveWorkspaceConnection).not.toHaveBeenCalled();
  });
});
