// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

import type { ProductTelemetry } from "@proliferate/product-client/host/product-host";
import {
  makeTestProductHost,
  productHostWrapper,
} from "@/test/product-host-test-utils";
import { useProductTelemetry } from "./use-product-telemetry";

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

function renderFacade(telemetry: ProductTelemetry) {
  const host = makeTestProductHost({ overrides: { telemetry } });
  return renderHook(() => useProductTelemetry(), {
    wrapper: productHostWrapper(host),
  });
}

describe("useProductTelemetry", () => {
  it("forwards a typed event to host.telemetry.track exactly once", () => {
    const telemetry = spyTelemetry();
    const { result } = renderFacade(telemetry);

    result.current.track("screen_viewed", { route: "main" });

    expect(telemetry.track).toHaveBeenCalledTimes(1);
    expect(telemetry.track).toHaveBeenCalledWith({
      name: "screen_viewed",
      properties: { route: "main" },
    });
  });

  it("forwards a payload-less event with undefined properties", () => {
    const telemetry = spyTelemetry();
    const { result } = renderFacade(telemetry);

    result.current.track("app_update_check_started", undefined);

    expect(telemetry.track).toHaveBeenCalledWith({
      name: "app_update_check_started",
      properties: undefined,
    });
  });

  it("delegates captureException/setUser/setTag/routeChanged/getSupportContext once each", () => {
    const telemetry = spyTelemetry();
    const { result } = renderFacade(telemetry);

    const error = new Error("boom");
    result.current.captureException(error, { tags: { k: "v" } });
    result.current.setUser(null);
    result.current.setTag("route", "main");
    result.current.routeChanged({ pathname: "/", routeId: "main" });
    result.current.getSupportContext();

    expect(telemetry.captureException).toHaveBeenCalledExactlyOnceWith(error, {
      tags: { k: "v" },
    });
    expect(telemetry.setUser).toHaveBeenCalledExactlyOnceWith(null);
    expect(telemetry.setTag).toHaveBeenCalledExactlyOnceWith("route", "main");
    expect(telemetry.routeChanged).toHaveBeenCalledExactlyOnceWith({
      pathname: "/",
      routeId: "main",
    });
    expect(telemetry.getSupportContext).toHaveBeenCalledTimes(1);
  });

  it("returns a stable adapter identity while the host is unchanged", () => {
    const telemetry = spyTelemetry();
    const { result, rerender } = renderFacade(telemetry);
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});
