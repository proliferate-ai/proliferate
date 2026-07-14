// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { Link, MemoryRouter } from "react-router-dom";

import type {
  AuthState,
  ProductTelemetry,
} from "@proliferate/product-client/host/product-host";
import { ProductHostProvider } from "@proliferate/product-client/host/ProductHostProvider";
import {
  makeTestProductHost,
  testAuthState,
} from "@/test/product-host-test-utils";
import { useTelemetryRouteViews } from "./use-telemetry-route-views";
import { useTelemetryAuthIdentity } from "./use-telemetry-auth-identity";

function spyTelemetry(): ProductTelemetry {
  return {
    track: vi.fn(),
    captureException: vi.fn(),
    setUser: vi.fn(),
    setTag: vi.fn(),
    routeChanged: vi.fn(),
    getSupportContext: vi.fn(() => ({ clientReleaseId: "desktop@test" })),
  };
}

describe("useTelemetryRouteViews", () => {
  function RouteHarness() {
    useTelemetryRouteViews();
    return (
      <>
        <Link to="/">home</Link>
        <Link to="/settings">settings</Link>
        <Link to="/workflows">workflows</Link>
        <Link to="/workflows/run-1">workflows-run</Link>
      </>
    );
  }

  function renderRoutes(telemetry: ProductTelemetry) {
    const host = makeTestProductHost({ overrides: { telemetry } });
    return render(
      <ProductHostProvider host={host}>
        <MemoryRouter initialEntries={["/"]}>
          <RouteHarness />
        </MemoryRouter>
      </ProductHostProvider>,
    );
  }

  it("emits exactly one screen_viewed per classified route and dedups repeats", () => {
    const telemetry = spyTelemetry();
    const { getByText } = renderRoutes(telemetry);

    // Initial mount classifies "/" as main.
    expect(telemetry.track).toHaveBeenCalledTimes(1);
    expect(telemetry.track).toHaveBeenLastCalledWith({
      name: "screen_viewed",
      properties: { route: "main" },
    });
    expect(telemetry.routeChanged).toHaveBeenLastCalledWith({
      pathname: "/",
      routeId: "main",
    });

    fireEvent.click(getByText("settings"));
    expect(telemetry.track).toHaveBeenCalledTimes(2);
    expect(telemetry.track).toHaveBeenLastCalledWith({
      name: "screen_viewed",
      properties: { route: "settings" },
    });

    // Two distinct pathnames that classify to the same "workflows" route emit
    // only once: the second is deduped.
    fireEvent.click(getByText("workflows"));
    expect(telemetry.track).toHaveBeenCalledTimes(3);
    fireEvent.click(getByText("workflows-run"));
    expect(telemetry.track).toHaveBeenCalledTimes(3);
  });
});

describe("useTelemetryAuthIdentity", () => {
  function AuthHarness() {
    useTelemetryAuthIdentity();
    return null;
  }

  function renderAuth(authState: AuthState, telemetry: ProductTelemetry) {
    const host = makeTestProductHost({ authState, overrides: { telemetry } });
    return render(
      <ProductHostProvider host={host}>
        <AuthHarness />
      </ProductHostProvider>,
    );
  }

  it("reports the authenticated identity and status from host.auth.state", () => {
    const telemetry = spyTelemetry();
    renderAuth(
      testAuthState("authenticated", {
        id: "user-1",
        email: "a@example.test",
        display_name: "Ada",
      }),
      telemetry,
    );

    expect(telemetry.setUser).toHaveBeenCalledWith(
      expect.objectContaining({ id: "user-1", email: "a@example.test" }),
    );
    expect(telemetry.setTag).toHaveBeenCalledWith("auth_status", "authenticated");
  });

  it("clears the identity and tags the status when anonymous", () => {
    const telemetry = spyTelemetry();
    renderAuth(testAuthState("anonymous"), telemetry);

    expect(telemetry.setUser).toHaveBeenCalledWith(null);
    expect(telemetry.setTag).toHaveBeenCalledWith("auth_status", "anonymous");
  });

  it("clears the identity on the authenticated-but-degraded (null user) path", () => {
    const telemetry = spyTelemetry();
    renderAuth(testAuthState("authenticated", null), telemetry);

    expect(telemetry.setUser).toHaveBeenCalledWith(null);
    expect(telemetry.setTag).toHaveBeenCalledWith("auth_status", "authenticated");
  });
});
