// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnyHarnessRuntime } from "../context/AnyHarnessRuntime.js";
import { AnyHarnessWorkspace } from "../context/AnyHarnessWorkspace.js";
import { useAgentReconcileStatusQuery, useAgentsQuery } from "./agents.js";
import { useRuntimeHealthQuery } from "./runtime.js";
import { useRuntimeWorkspacesQuery, useWorkspaceQuery } from "./workspaces.js";

const mocks = vi.hoisted(() => ({
  getClient: vi.fn(),
  getHealth: vi.fn(),
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
    mocks.getReconcileStatus.mockReset();
    mocks.getWorkspace.mockReset();
    mocks.listAgents.mockReset();
    mocks.listWorkspaces.mockReset();
  });

  it("keeps local runtime queries idle while a cloud workspace query resolves", async () => {
    mocks.getWorkspace.mockResolvedValue({ id: "sandbox-workspace-1" });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const { result } = renderHook(() => ({
      agents: useAgentsQuery(),
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

    expect(result.current.agents.fetchStatus).toBe("idle");
    expect(result.current.health.fetchStatus).toBe("idle");
    expect(result.current.reconcile.fetchStatus).toBe("idle");
    expect(result.current.runtimeWorkspaces.fetchStatus).toBe("idle");
    expect(mocks.listAgents).not.toHaveBeenCalled();
    expect(mocks.getHealth).not.toHaveBeenCalled();
    expect(mocks.getReconcileStatus).not.toHaveBeenCalled();
    expect(mocks.listWorkspaces).not.toHaveBeenCalled();
    expect(mocks.getClient).toHaveBeenCalledTimes(1);
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
});
