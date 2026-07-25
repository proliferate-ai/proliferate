// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const bridgeMocks = vi.hoisted(() => ({
  listAvailableEditors: vi.fn(),
}));
const telemetryMocks = vi.hoisted(() => ({
  captureException: vi.fn(),
}));

vi.mock("@proliferate/product-client/host/ProductHostProvider", () => ({
  useProductHost: () => ({
    desktop: { files: { listAvailableEditors: bridgeMocks.listAvailableEditors } },
  }),
}));
vi.mock("@/hooks/telemetry/facade/use-product-telemetry", () => ({
  useProductTelemetry: () => telemetryMocks,
}));

import { useAvailableEditors } from "./use-available-editors";

let queryClient: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
});

afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.clearAllMocks();
});

describe("useAvailableEditors", () => {
  it("captures a bridge failure through ProductHost telemetry and keeps the fallback", async () => {
    const error = new Error("editor discovery failed");
    bridgeMocks.listAvailableEditors.mockRejectedValue(error);

    const { result } = renderHook(() => useAvailableEditors(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
    expect(telemetryMocks.captureException).toHaveBeenCalledTimes(1);
    expect(telemetryMocks.captureException).toHaveBeenCalledWith(error, {
      tags: {
        action: "list_available_editors",
        domain: "settings",
        route: "settings",
      },
    });
  });
});
