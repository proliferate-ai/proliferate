import { useEffect } from "react";
import type {
  AuthState,
} from "@proliferate/product-client/host/product-host";
import type { DesktopRuntimeBridge } from "@proliferate/product-client/host/desktop-bridge";
import type { DesktopDiagnosticsBridge } from "@proliferate/product-client/host/desktop-diagnostics-bridge";

import { bootstrapHarnessRuntime } from "@/lib/access/anyharness/runtime-bootstrap";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";

export function useDesktopRuntimeBootstrapLifecycle(
  runtime: DesktopRuntimeBridge,
  diagnostics: DesktopDiagnosticsBridge,
  authStatus: AuthState["status"],
): void {
  const authReady = authStatus !== "loading";

  useEffect(() => {
    if (!authReady) {
      return;
    }

    const runtimeBootstrapStartedAt = performance.now();
    const controller = new AbortController();
    diagnostics.recordStartupEvent({
      message: "app.runtime_bootstrap.start",
      authStatus: "ready",
    });
    void bootstrapHarnessRuntime(runtime, controller.signal).finally(() => {
      if (controller.signal.aborted) {
        return;
      }
      diagnostics.recordStartupEvent({
        message: "app.runtime_bootstrap.completed",
        elapsedMs: Math.round(performance.now() - runtimeBootstrapStartedAt),
        authStatus: "ready",
      });
    });
    return () => {
      controller.abort();
      useHarnessConnectionStore.getState().resetConnectionState();
    };
  }, [authReady, diagnostics, runtime]);
}
