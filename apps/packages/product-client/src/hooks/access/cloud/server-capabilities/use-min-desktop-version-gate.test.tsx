// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useMinDesktopVersionGate } from "#product/hooks/access/cloud/server-capabilities/use-min-desktop-version-gate";

const gateFetchMocks = vi.hoisted(() => ({
  fetchMinDesktopVersionGate: vi.fn(),
}));
const appVersionMocks = vi.hoisted(() => ({ version: "0.2.0" }));
const telemetryMocks = vi.hoisted(() => ({ track: vi.fn() }));

vi.mock("#product/lib/access/cloud/server-capabilities", () => ({
  fetchMinDesktopVersionGate: gateFetchMocks.fetchMinDesktopVersionGate,
}));

vi.mock("@proliferate/product-client/host/ProductHostProvider", () => ({
  useProductHost: () => ({ deployment: { apiBaseUrl: "http://control-plane.test" } }),
}));

vi.mock("#product/hooks/access/tauri/app/use-app-version", () => ({
  useAppVersion: () => ({ data: appVersionMocks.version, isPending: false }),
}));

vi.mock("#product/hooks/telemetry/facade/use-product-telemetry", () => ({
  useProductTelemetry: () => telemetryMocks,
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

afterEach(() => {
  vi.clearAllMocks();
  appVersionMocks.version = "0.2.0";
});

describe("useMinDesktopVersionGate", () => {
  it("returns null while the gate query hasn't resolved", () => {
    gateFetchMocks.fetchMinDesktopVersionGate.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useMinDesktopVersionGate(), { wrapper });

    expect(result.current).toBeNull();
  });

  it("is not blocked when the server never opted into enforcement", async () => {
    gateFetchMocks.fetchMinDesktopVersionGate.mockResolvedValue({
      minDesktopVersion: "0.4.0",
      minDesktopVersionEnforced: false,
    });

    const { result } = renderHook(() => useMinDesktopVersionGate(), { wrapper });

    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current?.blocked).toBe(false);
  });

  it("is not blocked when the server declares no meta (self-hosted, older, unreachable)", async () => {
    gateFetchMocks.fetchMinDesktopVersionGate.mockResolvedValue(null);

    const { result } = renderHook(() => useMinDesktopVersionGate(), { wrapper });

    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current?.blocked).toBe(false);
  });

  it("blocks and emits the block telemetry event when enforced and confidently older", async () => {
    gateFetchMocks.fetchMinDesktopVersionGate.mockResolvedValue({
      minDesktopVersion: "0.4.0",
      minDesktopVersionEnforced: true,
    });

    const { result } = renderHook(() => useMinDesktopVersionGate(), { wrapper });

    await waitFor(() => expect(result.current?.blocked).toBe(true));
    expect(result.current).toMatchObject({
      blocked: true,
      appVersion: "0.2.0",
      minDesktopVersion: "0.4.0",
    });
    expect(telemetryMocks.track).toHaveBeenCalledWith("desktop_minversion_block", {
      app_version: "0.2.0",
      min_desktop_version: "0.4.0",
    });
  });

  it("fails open (not blocked) on a dev/unstamped app version even if enforced", async () => {
    appVersionMocks.version = "0.0.0-dev";
    gateFetchMocks.fetchMinDesktopVersionGate.mockResolvedValue({
      minDesktopVersion: "0.4.0",
      minDesktopVersionEnforced: true,
    });

    const { result } = renderHook(() => useMinDesktopVersionGate(), { wrapper });

    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current?.blocked).toBe(false);
  });
});
