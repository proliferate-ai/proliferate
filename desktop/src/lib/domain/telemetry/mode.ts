export type DesktopTelemetryMode = "local_dev" | "self_managed" | "hosted_product";

export interface DesktopTelemetryRoutingState {
  disabled: boolean;
  telemetryMode: DesktopTelemetryMode;
  anonymousEnabled: boolean;
  vendorEnabled: boolean;
}

interface ResolveDesktopTelemetryRoutingInput {
  buildTelemetryDisabled: boolean;
  runtimeTelemetryDisabled: boolean;
  viteDev: boolean;
  nativeDevProfile: boolean;
  apiOrigin: string;
  officialHostedOrigins: readonly string[];
}

function resolveDesktopTelemetryMode(
  input: ResolveDesktopTelemetryRoutingInput,
): DesktopTelemetryMode {
  if (input.viteDev || input.nativeDevProfile) {
    return "local_dev";
  }

  return input.officialHostedOrigins.includes(input.apiOrigin)
    ? "hosted_product"
    : "self_managed";
}

export function resolveDesktopTelemetryRoutingState(
  input: ResolveDesktopTelemetryRoutingInput,
): DesktopTelemetryRoutingState {
  const disabled = input.buildTelemetryDisabled || input.runtimeTelemetryDisabled;
  const telemetryMode = resolveDesktopTelemetryMode(input);

  return {
    disabled,
    telemetryMode,
    anonymousEnabled: !disabled,
    vendorEnabled: !disabled && telemetryMode === "hosted_product",
  };
}
