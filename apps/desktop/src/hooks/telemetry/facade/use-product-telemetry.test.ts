import { describe, expect, it, vi } from "vitest";
import type { ProductTelemetry } from "@proliferate/product-client/host/product-host";

import { createProductTelemetryFacade } from "./use-product-telemetry";

function makeTelemetry(): ProductTelemetry {
  return {
    track: vi.fn(),
    captureException: vi.fn(),
    setUser: vi.fn(),
    setTag: vi.fn(),
    routeChanged: vi.fn(),
    getSupportContext: vi.fn(() => ({ clientReleaseId: "desktop@test" })),
  };
}

describe("createProductTelemetryFacade", () => {
  it("delegates typed product events exactly once", () => {
    const telemetry = makeTelemetry();
    const facade = createProductTelemetryFacade(telemetry);

    facade.track("workspace_selected", { workspace_kind: "cloud" });
    facade.track("connectors_pane_viewed", undefined);

    expect(telemetry.track).toHaveBeenNthCalledWith(1, {
      name: "workspace_selected",
      properties: { workspace_kind: "cloud" },
    });
    expect(telemetry.track).toHaveBeenNthCalledWith(2, {
      name: "connectors_pane_viewed",
    });
  });

  it("forwards identity, errors, route metadata, and support context", () => {
    const telemetry = makeTelemetry();
    const facade = createProductTelemetryFacade(telemetry);
    const error = new Error("boom");
    const context = { tags: { domain: "test" } };
    const user = { id: "user-1", email: "pablo@example.test" };
    const route = { pathname: "/settings", routeId: "settings" };

    facade.captureException(error, context);
    facade.setUser(user);
    facade.setTag("organization_id", "org-1");
    facade.routeChanged(route);

    expect(telemetry.captureException).toHaveBeenCalledWith(error, context);
    expect(telemetry.setUser).toHaveBeenCalledWith(user);
    expect(telemetry.setTag).toHaveBeenCalledWith("organization_id", "org-1");
    expect(telemetry.routeChanged).toHaveBeenCalledWith(route);
    expect(facade.getSupportContext()).toEqual({
      clientReleaseId: "desktop@test",
    });
  });
});
