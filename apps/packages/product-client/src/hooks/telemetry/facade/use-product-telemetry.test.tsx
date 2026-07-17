// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { AnyHarnessError } from "@anyharness/sdk";

import type { ProductTelemetry } from "@proliferate/product-client/host/product-host";
import {
  makeTestProductHost,
  productHostWrapper,
} from "#product/test/product-host-test-utils";
import { useProductTelemetry } from "#product/hooks/telemetry/facade/use-product-telemetry";

function spyTelemetry(): ProductTelemetry {
  return {
    track: vi.fn(),
    captureException: vi.fn(),
    setUser: vi.fn(),
    setTag: vi.fn(),
    routeChanged: vi.fn(),
    getSupportContext: vi.fn(() => ({ clientReleaseId: "desktop@test" })),
    getAnonymousInstallId: vi.fn(async () => null),
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

  it("keeps AnyHarness caller detail out of the explicit host capture", () => {
    const telemetry = spyTelemetry();
    const { result } = renderFacade(telemetry);
    const rawTail = "provider stderr: caller-only-secret";
    const error = new AnyHarnessError({
      type: "about:blank",
      title: "Internal error",
      status: 500,
      detail: rawTail,
      code: "AGENT_STARTUP_FAILED",
    });

    result.current.captureException(error, {
      tags: { action: "create_session_with_resolved_config" },
    });

    const [capturedError, context] = vi.mocked(telemetry.captureException).mock.calls[0];
    expect(error.message).toBe(rawTail);
    expect(capturedError).toBeInstanceOf(Error);
    expect(capturedError).not.toBe(error);
    expect((capturedError as Error).message).toBe(
      "AnyHarness request failed (AGENT_STARTUP_FAILED)",
    );
    expect("problem" in (capturedError as object)).toBe(false);
    expect("cause" in (capturedError as object)).toBe(false);
    expect((capturedError as Error).stack).not.toContain(rawTail);
    expect(JSON.stringify(capturedError)).not.toContain(rawTail);
    expect(context).toEqual({
      tags: { action: "create_session_with_resolved_config" },
    });
  });

  it("returns a stable adapter identity while the host is unchanged", () => {
    const telemetry = spyTelemetry();
    const { result, rerender } = renderFacade(telemetry);
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});
