import { describe, expect, it } from "vitest";
import { resolveDesktopTelemetryRoutingState } from "./mode";

const HOSTED_ORIGINS = ["https://api.proliferate.com", "https://app.proliferate.com"];

describe("resolveDesktopTelemetryRoutingState", () => {
  it("disables both telemetry backends when telemetry is disabled", () => {
    expect(
      resolveDesktopTelemetryRoutingState({
        buildTelemetryDisabled: false,
        runtimeTelemetryDisabled: true,
        viteDev: false,
        nativeDevProfile: false,
        apiOrigin: "https://api.proliferate.com",
        officialHostedOrigins: HOSTED_ORIGINS,
      }),
    ).toEqual({
      disabled: true,
      telemetryMode: "hosted_product",
      anonymousEnabled: false,
      vendorEnabled: false,
    });
  });

  it("treats vite dev as local_dev regardless of the API origin", () => {
    expect(
      resolveDesktopTelemetryRoutingState({
        buildTelemetryDisabled: false,
        runtimeTelemetryDisabled: false,
        viteDev: true,
        nativeDevProfile: false,
        apiOrigin: "https://api.proliferate.com",
        officialHostedOrigins: HOSTED_ORIGINS,
      }),
    ).toEqual({
      disabled: false,
      telemetryMode: "local_dev",
      anonymousEnabled: true,
      vendorEnabled: false,
    });
  });

  it("treats native dev profile as local_dev", () => {
    expect(
      resolveDesktopTelemetryRoutingState({
        buildTelemetryDisabled: false,
        runtimeTelemetryDisabled: false,
        viteDev: false,
        nativeDevProfile: true,
        apiOrigin: "https://api.proliferate.com",
        officialHostedOrigins: HOSTED_ORIGINS,
      }).telemetryMode,
    ).toBe("local_dev");
  });

  it("enables vendor telemetry only for hosted product origins", () => {
    expect(
      resolveDesktopTelemetryRoutingState({
        buildTelemetryDisabled: false,
        runtimeTelemetryDisabled: false,
        viteDev: false,
        nativeDevProfile: false,
        apiOrigin: "https://api.proliferate.com",
        officialHostedOrigins: HOSTED_ORIGINS,
      }),
    ).toEqual({
      disabled: false,
      telemetryMode: "hosted_product",
      anonymousEnabled: true,
      vendorEnabled: true,
    });
  });

  it("routes custom API origins to self_managed mode", () => {
    expect(
      resolveDesktopTelemetryRoutingState({
        buildTelemetryDisabled: false,
        runtimeTelemetryDisabled: false,
        viteDev: false,
        nativeDevProfile: false,
        apiOrigin: "https://api.customer.example",
        officialHostedOrigins: HOSTED_ORIGINS,
      }),
    ).toEqual({
      disabled: false,
      telemetryMode: "self_managed",
      anonymousEnabled: true,
      vendorEnabled: false,
    });
  });
});
