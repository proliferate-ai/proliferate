// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnyHarnessRuntime } from "../context/AnyHarnessRuntime.js";
import { AnyHarnessWorkspace } from "../context/AnyHarnessWorkspace.js";
import {
  useAgentReconcileStatusQuery,
  useAgentsQuery,
  useWorkspaceAgentsQuery,
} from "./agents.js";
import { useAgentGatewayModelsQuery } from "./agent-gateway-catalog.js";
import { useRuntimeHealthQuery } from "./runtime.js";
import { useRuntimeWorkspacesQuery, useWorkspaceQuery } from "./workspaces.js";

const mocks = vi.hoisted(() => ({
  getClient: vi.fn(),
  getHealth: vi.fn(),
  getGatewayModels: vi.fn(),
  getReconcileStatus: vi.fn(),
  getWorkspace: vi.fn(),
  listAgents: vi.fn(),
  listWorkspaces: vi.fn(),
}));

vi.mock("../lib/client-cache.js", () => ({
  getAnyHarnessClient: (connection: unknown) => {
    mocks.getClient(connection);
    return {
      runtime: { getHealth: mocks.getHealth },
      agents: {
        list: mocks.listAgents,
        getReconcileStatus: mocks.getReconcileStatus,
      },
      agentGatewayCatalog: { getGatewayModels: mocks.getGatewayModels },
      workspaces: {
        list: mocks.listWorkspaces,
        get: mocks.getWorkspace,
      },
    };
  },
}));

describe("runtime query gating", () => {
  afterEach(() => {
    cleanup();
    mocks.getClient.mockReset();
    mocks.getHealth.mockReset();
    mocks.getGatewayModels.mockReset();
    mocks.getReconcileStatus.mockReset();
    mocks.getWorkspace.mockReset();
    mocks.listAgents.mockReset();
    mocks.listWorkspaces.mockReset();
  });

  it("keeps local runtime queries idle while a cloud workspace query resolves", async () => {
    mocks.getWorkspace.mockResolvedValue({ id: "sandbox-workspace-1" });
    mocks.listAgents.mockResolvedValue([]);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const { result } = renderHook(() => ({
      agents: useAgentsQuery(),
      workspaceAgents: useWorkspaceAgentsQuery(),
      health: useRuntimeHealthQuery(),
      reconcile: useAgentReconcileStatusQuery(),
      runtimeWorkspaces: useRuntimeWorkspacesQuery(),
      workspace: useWorkspaceQuery({}),
    }), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>
          <AnyHarnessRuntime
            runtimeUrl={null}
            cacheScopeKey="https://api.test::user:user-1"
          >
            <AnyHarnessWorkspace
              workspaceId="cloud:workspace-1"
              resolveConnection={async () => ({
                runtimeUrl: "https://api.test/v1/gateway/cloud-sandbox/anyharness",
                authToken: "temporary-gateway-token",
                anyharnessWorkspaceId: "sandbox-workspace-1",
              })}
            >
              {children}
            </AnyHarnessWorkspace>
          </AnyHarnessRuntime>
        </QueryClientProvider>
      ),
    });

    await waitFor(() => expect(result.current.workspace.isSuccess).toBe(true));
    await waitFor(() => expect(result.current.workspaceAgents.isSuccess).toBe(true));

    expect(result.current.agents.fetchStatus).toBe("idle");
    expect(result.current.health.fetchStatus).toBe("idle");
    expect(result.current.reconcile.fetchStatus).toBe("idle");
    expect(result.current.runtimeWorkspaces.fetchStatus).toBe("idle");
    expect(mocks.listAgents).toHaveBeenCalledOnce();
    expect(mocks.getHealth).not.toHaveBeenCalled();
    expect(mocks.getReconcileStatus).not.toHaveBeenCalled();
    expect(mocks.listWorkspaces).not.toHaveBeenCalled();
    expect(mocks.getClient).toHaveBeenCalledTimes(2);
    expect(mocks.getClient).toHaveBeenCalledWith({
      runtimeUrl: "https://api.test/v1/gateway/cloud-sandbox/anyharness",
      authToken: "temporary-gateway-token",
      anyharnessWorkspaceId: "sandbox-workspace-1",
    });
    expect(mocks.getWorkspace).toHaveBeenCalledWith(
      "sandbox-workspace-1",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("resolves a fresh runtime connection for each settings runtime request", async () => {
    mocks.listAgents.mockResolvedValue([]);
    mocks.getHealth.mockResolvedValue({ status: "ok" });
    mocks.getGatewayModels.mockResolvedValue({ source: "seed", models: [] });
    const resolveConnection = vi.fn()
      .mockResolvedValueOnce({
        runtimeUrl: "https://api.test/v1/gateway/cloud-sandbox/anyharness",
        authToken: "gateway-token-1",
      })
      .mockResolvedValueOnce({
        runtimeUrl: "https://api.test/v1/gateway/cloud-sandbox/anyharness",
        authToken: "gateway-token-2",
      })
      .mockResolvedValueOnce({
        runtimeUrl: "https://api.test/v1/gateway/cloud-sandbox/anyharness",
        authToken: "gateway-token-3",
      });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const { result } = renderHook(() => ({
      agents: useAgentsQuery(),
      gatewayModels: useAgentGatewayModelsQuery("claude"),
      health: useRuntimeHealthQuery(),
    }), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>
          <AnyHarnessRuntime
            runtimeUrl="https://api.test/v1/gateway/cloud-sandbox/anyharness"
            cacheScopeKey="https://api.test::user:user-1"
            resolveConnection={resolveConnection}
          >
            {children}
          </AnyHarnessRuntime>
        </QueryClientProvider>
      ),
    });

    await waitFor(() => expect(result.current.agents.isSuccess).toBe(true));
    await waitFor(() => expect(result.current.gatewayModels.isSuccess).toBe(true));
    await waitFor(() => expect(result.current.health.isSuccess).toBe(true));

    expect(resolveConnection).toHaveBeenCalledTimes(3);
    expect(mocks.getClient).toHaveBeenCalledWith({
      runtimeUrl: "https://api.test/v1/gateway/cloud-sandbox/anyharness",
      authToken: "gateway-token-1",
    });
    expect(mocks.getClient).toHaveBeenCalledWith({
      runtimeUrl: "https://api.test/v1/gateway/cloud-sandbox/anyharness",
      authToken: "gateway-token-2",
    });
    expect(mocks.getClient).toHaveBeenCalledWith({
      runtimeUrl: "https://api.test/v1/gateway/cloud-sandbox/anyharness",
      authToken: "gateway-token-3",
    });
  });
});
