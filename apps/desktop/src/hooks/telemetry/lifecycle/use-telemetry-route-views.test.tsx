// @vitest-environment jsdom
import { act, render, waitFor } from "@testing-library/react";
import {
  MemoryRouter,
  useNavigate,
  type NavigateFunction,
} from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { ProductHost } from "@proliferate/product-client/host/product-host";
import { ProductHostProvider } from "@proliferate/product-client/host/ProductHostProvider";

import { useTelemetryRouteViews } from "./use-telemetry-route-views";

function makeHost(): ProductHost {
  return {
    surface: "desktop",
    deployment: { apiBaseUrl: "https://api.example.test" },
    auth: {
      authRequired: true,
      state: { status: "anonymous", methods: [] },
      restoreSession: async () => {},
      startLogin: async () => ({
        provider: "github",
        source: "desktop_callback",
      }),
      finishLogin: async () => {},
      cancelLogin: async () => {},
      logout: async () => ({ provider: "github" }),
    },
    cloud: { client: null },
    storage: {
      getItem: async () => null,
      setItem: async () => {},
      removeItem: async () => {},
    },
    links: {
      openExternal: async () => {},
      buildReturnUrl: () => "",
      observeInboundEntries: () => () => {},
    },
    clipboard: { writeText: async () => {} },
    telemetry: {
      track: vi.fn(),
      captureException: vi.fn(),
      setUser: vi.fn(),
      setTag: vi.fn(),
      routeChanged: vi.fn(),
      getSupportContext: () => ({ clientReleaseId: "test" }),
    },
    desktop: null,
  };
}

function RouteTelemetryProbe({
  onNavigate,
}: {
  onNavigate: (navigate: NavigateFunction) => void;
}) {
  onNavigate(useNavigate());
  useTelemetryRouteViews();
  return null;
}

describe("useTelemetryRouteViews", () => {
  it("classifies in product code and emits one screen event per route id", async () => {
    const host = makeHost();
    let navigate: NavigateFunction | null = null;

    render(
      <ProductHostProvider host={host}>
        <MemoryRouter initialEntries={["/workflows/one"]}>
          <RouteTelemetryProbe
            onNavigate={(nextNavigate) => {
              navigate = nextNavigate;
            }}
          />
        </MemoryRouter>
      </ProductHostProvider>,
    );

    await waitFor(() => {
      expect(host.telemetry.track).toHaveBeenCalledTimes(1);
    });
    expect(host.telemetry.routeChanged).toHaveBeenCalledWith({
      pathname: "/workflows/one",
      routeId: "workflows",
    });

    await act(async () => {
      navigate?.("/workflows/two");
    });
    expect(host.telemetry.track).toHaveBeenCalledTimes(1);
    expect(host.telemetry.routeChanged).toHaveBeenCalledTimes(1);

    await act(async () => {
      navigate?.("/settings");
    });
    await waitFor(() => {
      expect(host.telemetry.track).toHaveBeenCalledTimes(2);
    });
    expect(host.telemetry.track).toHaveBeenLastCalledWith({
      name: "screen_viewed",
      properties: { route: "settings" },
    });
    expect(host.telemetry.routeChanged).toHaveBeenLastCalledWith({
      pathname: "/settings",
      routeId: "settings",
    });
  });
});
