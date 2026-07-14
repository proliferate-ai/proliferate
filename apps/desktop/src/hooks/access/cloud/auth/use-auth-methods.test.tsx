// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProductHostProvider } from "@proliferate/product-client/host/ProductHostProvider";
import { makeTestProductHost } from "@/test/product-host-fixtures";

const authMocks = vi.hoisted(() => ({
  getDesktopAuthMethods: vi.fn(),
}));

vi.mock("@/lib/integrations/auth/proliferate-auth-password", () => authMocks);
// Force the control-plane probe reachable so the methods query is enabled and
// runs its queryFn. The `*For` variant is the one the public hook composes.
vi.mock("@/hooks/access/cloud/use-control-plane-health", () => ({
  useControlPlaneHealthFor: () => ({ data: true }),
}));

import { useDesktopAuthMethods } from "./use-auth-methods";

function createWrapper(apiBaseUrl: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const host = makeTestProductHost({ deployment: { apiBaseUrl } });
  return function Wrapper({ children }: PropsWithChildren) {
    return (
      <QueryClientProvider client={queryClient}>
        <ProductHostProvider host={host}>{children}</ProductHostProvider>
      </QueryClientProvider>
    );
  };
}

describe("useDesktopAuthMethods", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("derives its scope and probe target from host.deployment.apiBaseUrl", async () => {
    authMocks.getDesktopAuthMethods.mockResolvedValue({
      passwordLogin: true,
      github: false,
    });

    const { result } = renderHook(() => useDesktopAuthMethods(), {
      wrapper: createWrapper("https://host-deployment.example.test"),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // The queryFn receives exactly the host deployment base URL — the fetch is
    // host-derived, not read from a module singleton.
    expect(authMocks.getDesktopAuthMethods).toHaveBeenCalledWith(
      "https://host-deployment.example.test",
    );
  });
});
