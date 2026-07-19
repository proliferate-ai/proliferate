// @vitest-environment jsdom

import {
  AnyHarnessRuntime,
  useAgentsQuery,
  useAnyHarnessRuntimeContext,
  useReconcileAgentsMutation,
} from "@anyharness/sdk-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { ProliferateCloudClient } from "@proliferate/cloud-sdk";
import { expect, it, vi } from "vitest";
import { ProductHostProvider } from "@proliferate/product-client/host/ProductHostProvider";
import { makeTestProductHost } from "#product/test/product-host-fixtures";
import { CloudAnyHarnessRuntimeProvider } from "#product/providers/CloudAnyHarnessRuntimeProvider";

it("targets the one Cloud sandbox runtime with a fresh token per request", async () => {
  const getAccessToken = vi.fn()
    .mockResolvedValueOnce("cloud-token-1")
    .mockResolvedValueOnce("cloud-token-2");
  const cloudClient = {
    buildUrl: (path: string) => `https://api.test${path}`,
  } as ProliferateCloudClient;
  const fixtureFetch = vi.fn() as unknown as typeof globalThis.fetch;
  const baseHost = makeTestProductHost({ cloudClient });
  const host = {
    ...baseHost,
    cloud: {
      client: cloudClient,
      getSandboxGatewayAccessToken: getAccessToken,
    },
  };

  const { result } = renderHook(() => useAnyHarnessRuntimeContext(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <ProductHostProvider host={host}>
        <AnyHarnessRuntime
          runtimeUrl="http://local.test"
          cacheScopeKey="actor:user-1"
          fetch={fixtureFetch}
        >
          <CloudAnyHarnessRuntimeProvider>
            {children}
          </CloudAnyHarnessRuntimeProvider>
        </AnyHarnessRuntime>
      </ProductHostProvider>
    ),
  });

  expect(result.current.runtimeUrl).toBe(
    "https://api.test/v1/gateway/cloud-sandbox/anyharness",
  );
  expect(result.current.cacheScopeKey).toBe("actor:user-1");
  const resolveConnection = result.current.resolveConnection;
  if (!resolveConnection) throw new Error("Expected a Cloud runtime resolver.");

  await act(async () => {
    await expect(resolveConnection()).resolves.toEqual({
      runtimeUrl: "https://api.test/v1/gateway/cloud-sandbox/anyharness",
      authToken: "cloud-token-1",
      fetch: fixtureFetch,
    });
    await expect(resolveConnection()).resolves.toEqual({
      runtimeUrl: "https://api.test/v1/gateway/cloud-sandbox/anyharness",
      authToken: "cloud-token-2",
      fetch: fixtureFetch,
    });
  });

  expect(getAccessToken).toHaveBeenCalledTimes(2);
});

it("keeps a Cloud mutation and its invalidation read inside the inherited transport", async () => {
  const requests: string[] = [];
  const fixtureFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
    const method = init?.method?.toUpperCase()
      ?? (input instanceof Request ? input.method.toUpperCase() : "GET");
    requests.push(`${method} ${url}`);
    if (method === "GET" && url.endsWith("/v1/agents")) {
      return new Response(JSON.stringify([]), {
        headers: { "content-type": "application/json" },
      });
    }
    if (method === "POST" && url.endsWith("/v1/agents/reconcile")) {
      return new Response(JSON.stringify({
        jobId: "cloud-install",
        status: "running",
        reinstall: true,
        installedOnly: false,
        results: [],
      }), {
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`Unexpected fixture request: ${method} ${url}`);
  }) as typeof globalThis.fetch;
  const getAccessToken = vi.fn()
    .mockResolvedValueOnce("cloud-token-1")
    .mockResolvedValueOnce("cloud-token-2")
    .mockResolvedValueOnce("cloud-token-3");
  const cloudClient = {
    buildUrl: (path: string) => `https://api.test${path}`,
  } as ProliferateCloudClient;
  const baseHost = makeTestProductHost({ cloudClient });
  const host = {
    ...baseHost,
    cloud: {
      client: cloudClient,
      getSandboxGatewayAccessToken: getAccessToken,
    },
  };
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  const { result } = renderHook(() => ({
    agents: useAgentsQuery(),
    reconcile: useReconcileAgentsMutation(),
  }), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <ProductHostProvider host={host}>
          <AnyHarnessRuntime
            runtimeUrl="http://local.test"
            cacheScopeKey="actor:user-1"
            fetch={fixtureFetch}
          >
            <CloudAnyHarnessRuntimeProvider>
              {children}
            </CloudAnyHarnessRuntimeProvider>
          </AnyHarnessRuntime>
        </ProductHostProvider>
      </QueryClientProvider>
    ),
  });

  await waitFor(() => expect(result.current.agents.isSuccess).toBe(true));
  await act(async () => {
    await result.current.reconcile.mutateAsync({
      reinstall: true,
      agentKinds: ["claude"],
    });
  });
  await waitFor(() => expect(fixtureFetch).toHaveBeenCalledTimes(3));

  expect(requests).toEqual([
    "GET https://api.test/v1/gateway/cloud-sandbox/anyharness/v1/agents",
    "POST https://api.test/v1/gateway/cloud-sandbox/anyharness/v1/agents/reconcile",
    "GET https://api.test/v1/gateway/cloud-sandbox/anyharness/v1/agents",
  ]);
  expect(getAccessToken).toHaveBeenCalledTimes(3);
});
