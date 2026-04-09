import { useEffect, useRef } from "react";
import type { RuntimeConnectionTelemetryState } from "@/lib/domain/telemetry/events";
import {
  setTelemetryTag,
  trackProductEvent,
} from "@/lib/integrations/telemetry/client";
import { useHarnessStore } from "@/stores/sessions/harness-store";

export function useTelemetryRuntimeState() {
  const connectionState = useHarnessStore((state) => state.connectionState);
  const runtimeError = useHarnessStore((state) => state.error);
  const previousConnectionStateRef = useRef<RuntimeConnectionTelemetryState | null>(null);

  useEffect(() => {
    if (previousConnectionStateRef.current === connectionState) return;
    previousConnectionStateRef.current = connectionState;

    setTelemetryTag("runtime_connection_state", connectionState);
    trackProductEvent("runtime_connection_state_changed", {
      connection_state: connectionState,
      has_error: Boolean(runtimeError),
    });
  }, [connectionState, runtimeError]);
}
