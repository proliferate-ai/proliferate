import { useEffect } from "react";
import type {
  AuthState,
} from "@proliferate/product-client/host/product-host";
import type {
  DesktopRuntimeBridge,
} from "@proliferate/product-client/host/desktop-bridge";

import { bootstrapHarnessRuntime } from "@/lib/access/anyharness/runtime-bootstrap";
import { logRendererEvent } from "@/lib/access/tauri/diagnostics";
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
  authStatus: AuthState["status"],
): void {
  const authReady = authStatus !== "loading";

  useEffect(() => {
    if (!authReady) {
      return;
    }

    const runtimeBootstrapStartedAt = startStartupTimer();
    const controller = new AbortController();
    recordAppRendererEvent("app.runtime_bootstrap.start");
    logStartupDebug("app.runtime_bootstrap.start", { authStatus: "ready" });
    void bootstrapHarnessRuntime(runtime, controller.signal).finally(() => {
      if (controller.signal.aborted) {
        return;
      }
      recordAppRendererEvent(
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
  }, [authReady, runtime]);
}

function recordAppRendererEvent(message: string, elapsedMs?: number): void {
  recordBootDiagnostic(
    `app_bootstrap.${message}`,
    elapsedMs === undefined ? undefined : { elapsedMs },
  );
  void logRendererEvent({
    source: "app_bootstrap",
    message,
    elapsedMs,
  }).catch(() => {
    // Native logging is diagnostic-only; app startup should never depend on it.
  });
}
