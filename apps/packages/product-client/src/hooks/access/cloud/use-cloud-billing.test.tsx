// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  captureException: vi.fn(),
  getCloudBillingPlan: vi.fn(),
}));

vi.mock("@proliferate/cloud-sdk/client/billing", () => ({
  createBillingPortalSession: vi.fn(),
  createCloudCheckoutSession: vi.fn(),
  createRefillCheckoutSession: vi.fn(),
  getCloudBillingPlan: mocks.getCloudBillingPlan,
  updateOverageSettings: vi.fn(),
}));

vi.mock("#product/hooks/telemetry/facade/use-product-telemetry", () => ({
  useProductTelemetry: () => ({ captureException: mocks.captureException }),
}));

import { useCloudBillingQuery } from "#product/hooks/access/cloud/use-cloud-billing";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useCloudBillingQuery", () => {
  it("preserves transport failures and fingerprints them by operation", async () => {
    const error = new TypeError("Load failed");
    mocks.getCloudBillingPlan.mockRejectedValue(error);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const { result } = renderHook(() => useCloudBillingQuery(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      ),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(mocks.captureException).toHaveBeenCalledWith(error, {
      tags: {
        action: "fetch_billing_plan",
        domain: "cloud_billing",
        route: "settings",
      },
      fingerprint: ["{{ default }}", "fetch_billing_plan"],
    });
  });
});
