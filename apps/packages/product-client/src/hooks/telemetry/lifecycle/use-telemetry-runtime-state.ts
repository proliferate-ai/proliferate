import { useEffect, useRef } from "react";
import type { RuntimeConnectionTelemetryState } from "#product/lib/domain/telemetry/events";
import { useProductTelemetry } from "#product/hooks/telemetry/facade/use-product-telemetry";
import { useHarnessConnectionStore } from "#product/stores/sessions/harness-connection-store";

// Owns runtime connection telemetry tags and events. Reports through the typed
// telemetry adapter. Does not own runtime connection state.
export function useTelemetryRuntimeState() {
  const connectionState = useHarnessConnectionStore((state) => state.connectionState);
  const runtimeError = useHarnessConnectionStore((state) => state.error);
  const telemetry = useProductTelemetry();
  const previousConnectionStateRef = useRef<RuntimeConnectionTelemetryState | null>(null);

  useEffect(() => {
    if (previousConnectionStateRef.current === connectionState) return;
    previousConnectionStateRef.current = connectionState;

    telemetry.setTag("runtime_connection_state", connectionState);
    telemetry.track("runtime_connection_state_changed", {
      connection_state: connectionState,
      has_error: Boolean(runtimeError),
    });
  }, [connectionState, runtimeError, telemetry]);
}
