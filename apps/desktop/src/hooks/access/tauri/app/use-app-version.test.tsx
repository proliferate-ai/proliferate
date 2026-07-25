// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const bridgeMocks = vi.hoisted(() => ({
  getVersion: vi.fn(),
}));
const telemetryMocks = vi.hoisted(() => ({
  captureException: vi.fn(),
}));

vi.mock("@proliferate/product-client/host/ProductHostProvider", () => ({
  useProductHost: () => ({
    desktop: { updater: { getVersion: bridgeMocks.getVersion } },
  }),
}));
vi.mock("@/hooks/telemetry/facade/use-product-telemetry", () => ({
  useProductTelemetry: () => telemetryMocks,
}));

import { useAppVersion } from "./use-app-version";

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

describe("useAppVersion", () => {
  it("captures a bridge failure through ProductHost telemetry and keeps the dev fallback", async () => {
    const error = new Error("version unavailable");
    bridgeMocks.getVersion.mockRejectedValue(error);

    const { result } = renderHook(() => useAppVersion(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBe("0.0.0-dev");
    expect(telemetryMocks.captureException).toHaveBeenCalledTimes(1);
    expect(telemetryMocks.captureException).toHaveBeenCalledWith(error, {
      tags: {
        action: "load_app_version",
        domain: "settings",
        route: "settings",
      },
    });
  });
});
