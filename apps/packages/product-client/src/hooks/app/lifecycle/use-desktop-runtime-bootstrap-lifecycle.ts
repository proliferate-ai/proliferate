import { useEffect } from "react";
import type {
  AuthState,
} from "@proliferate/product-client/host/product-host";
import type {
  DesktopDiagnosticsBridge,
  DesktopRuntimeBridge,
} from "@proliferate/product-client/host/desktop-bridge";

import { bootstrapHarnessRuntime } from "#product/lib/access/anyharness/runtime-bootstrap";
import {
  recordBootDiagnostic,
} from "#product/lib/infra/measurement/measurement-port";
import {
  elapsedStartupMs,
  logStartupDebug,
  startStartupTimer,
} from "#product/lib/infra/measurement/measurement-port";
import {
  diagnosticField,
  recordRendererDiagnostic,
} from "#product/lib/infra/diagnostics/renderer-diagnostics-port";
import { useHarnessConnectionStore } from "#product/stores/sessions/harness-connection-store";

export function useDesktopRuntimeBootstrapLifecycle(
  runtime: DesktopRuntimeBridge,
  _diagnostics: DesktopDiagnosticsBridge,
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

function recordAppRendererEvent(
  message: string,
  elapsedMs?: number,
): void {
  recordBootDiagnostic(
    `app_bootstrap.${message}`,
    elapsedMs === undefined ? undefined : { elapsedMs },
  );
  recordRendererDiagnostic({
    name: `renderer.app_bootstrap.${message}`,
    severity: "info",
    kind: "milestone",
    privacy: "operational",
    fields: elapsedMs === undefined
      ? undefined
      : { elapsed_ms: diagnosticField(elapsedMs, "operational") },
  });
}
