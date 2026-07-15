import { useEffect } from "react";
import type {
  AuthState,
} from "@proliferate/product-client/host/product-host";
import type {
  DesktopDiagnosticsBridge,
  DesktopRuntimeBridge,
} from "@proliferate/product-client/host/desktop-bridge";

import { bootstrapHarnessRuntime } from "@/lib/access/anyharness/runtime-bootstrap";
import {
  recordBootDiagnostic,
} from "@/lib/infra/measurement/boot-stall-diagnostics";
import {
  elapsedStartupMs,
  logStartupDebug,
  startStartupTimer,
} from "@/lib/infra/measurement/debug-startup";
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

    const runtimeBootstrapStartedAt = startStartupTimer();
    const controller = new AbortController();
    recordAppRendererEvent(diagnostics, "app.runtime_bootstrap.start");
    logStartupDebug("app.runtime_bootstrap.start", { authStatus: "ready" });
    void bootstrapHarnessRuntime(runtime, controller.signal).finally(() => {
      if (controller.signal.aborted) {
        return;
      }
      recordAppRendererEvent(
        diagnostics,
        "app.runtime_bootstrap.completed",
        elapsedStartupMs(runtimeBootstrapStartedAt),
      );
      logStartupDebug("app.runtime_bootstrap.completed", {
        elapsedMs: elapsedStartupMs(runtimeBootstrapStartedAt),
        authStatus: "ready",
      });
    });
    return () => {
      controller.abort();
      useHarnessConnectionStore.getState().resetConnectionState();
    };
  }, [authReady, diagnostics, runtime]);
}

function recordAppRendererEvent(
  diagnostics: DesktopDiagnosticsBridge,
  message: string,
  elapsedMs?: number,
): void {
  recordBootDiagnostic(
    `app_bootstrap.${message}`,
    elapsedMs === undefined ? undefined : { elapsedMs },
  );
  void diagnostics.logEvent({
    source: "app_bootstrap",
    message,
    elapsedMs,
  }).catch(() => {
    // Native logging is diagnostic-only; app startup should never depend on it.
  });
}
