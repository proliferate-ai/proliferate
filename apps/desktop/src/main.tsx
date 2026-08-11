import "./lib/infra/diagnostics/renderer-diagnostics-install";
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { ProductClient } from "@proliferate/product-client/ProductClient";
import { initializeTheme } from "@proliferate/product-client/internal/config/theme";
import "./lib/access/cloud/client";
import { bootstrapProliferateApiConfig } from "./lib/infra/proliferate-api";
import { initializeAnonymousTelemetry } from "./lib/integrations/telemetry/anonymous";
import {
  getAnonymousTelemetryEndpoint,
  getClientDailyActivityEndpoint,
} from "./lib/integrations/telemetry/config";
import {
  getDesktopTelemetryRuntimeState,
  getDesktopTelemetryRootHandlers,
  initializeDesktopTelemetry,
} from "./lib/integrations/telemetry/client";
import { elapsedStartupMs, startStartupTimer } from "./lib/infra/measurement/debug-startup";
import {
  installBootStallDiagnostics,
  installWebKitPerformanceMeasureDetailGuard,
} from "./lib/infra/measurement/boot-stall-diagnostics";
import { installDebugMeasurement } from "./lib/infra/measurement/debug-measurement-install";
import { startLayoutShiftObserver } from "./lib/infra/measurement/debug-layout-shift";
import {
  recordRendererStartupEvent as recordStartupDiagnostic,
  warnRendererStartupFailure,
} from "./lib/infra/diagnostics/renderer-startup-diagnostics";
import { InstrumentedRoutes } from "./lib/integrations/telemetry/sentry";
import { DesktopHostProviders } from "./providers/DesktopHostProviders";
// Surface-specific desktop stylesheet stays host-side; the shared product CSS
// (xterm + product.css) rides with the moved ProductClient package entry.
import "@proliferate/design/desktop.css";

const IS_TAURI_DESKTOP =
  typeof window !== "undefined"
  && "__TAURI_INTERNALS__" in (window as unknown as Record<string, unknown>);
const API_CONFIG_STARTUP_BUDGET_MS = 1500;

document.documentElement.dataset.proliferateClient = "desktop";
initializeTheme();

const rendererStartupStartedAt = startStartupTimer();
installWebKitPerformanceMeasureDetailGuard();
installBootStallDiagnostics();
installDebugMeasurement();
startLayoutShiftObserver();

function recordRendererStartupEvent(message: string): void {
  recordStartupDiagnostic(message, elapsedStartupMs(rendererStartupStartedAt));
}

// ---------------------------------------------------------------------------
// Block webview reload in production.
//
// A Tauri webview reload destroys all in-memory state (session slots, SSE
// handles, transcripts, selections) while the sidecar keeps running. The
// frontend has no reconnection path today, so a reload effectively bricks
// the session until the user restarts the app.
//
// We intercept reload keys in the *capture* phase so this fires before any
// component-level keydown handlers. Other app shortcuts, including tab close,
// must still be allowed through to the owning shortcut hooks.
// ---------------------------------------------------------------------------
if (IS_TAURI_DESKTOP) {
  document.addEventListener(
    "keydown",
    (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "r") {
        e.preventDefault();
      }
    },
    { capture: true },
  );
}

if (!import.meta.env.DEV) {
  document.addEventListener(
    "keydown",
    (e: KeyboardEvent) => {
      if (e.key === "F5") {
        e.preventDefault();
        return;
      }
    },
    { capture: true },
  );

  document.addEventListener("contextmenu", (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    if (
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.isContentEditable
    ) {
      return;
    }
    e.preventDefault();
  });
}

function renderApp() {
  recordRendererStartupEvent("render.start");
  ReactDOM.createRoot(
    document.getElementById("root") as HTMLElement,
    getDesktopTelemetryRootHandlers(),
  ).render(
    <React.StrictMode>
      <BrowserRouter>
        <DesktopHostProviders>
          {/* The host supplies its Sentry-instrumented routes container; the
              package ProductClient owns the product provider root, lifecycle
              root, and route/UI tree. */}
          <ProductClient RoutesComponent={InstrumentedRoutes} />
        </DesktopHostProviders>
      </BrowserRouter>
    </React.StrictMode>,
  );
  recordRendererStartupEvent("render.scheduled");
}


let appRendered = false;

function renderAppOnce() {
  if (appRendered) {
    return;
  }
  appRendered = true;
  renderApp();
}

function warnStartupFailure(
  stage: string,
  message: string,
  error: unknown,
): void {
  warnRendererStartupFailure(stage, message, error);
}

function startAnonymousTelemetry(): void {
  let runtimeState: ReturnType<typeof getDesktopTelemetryRuntimeState>;
  try {
    runtimeState = getDesktopTelemetryRuntimeState();
  } catch (error) {
    warnStartupFailure(
      "telemetry_runtime_state",
      "Failed to resolve desktop telemetry runtime state",
      error,
    );
    return;
  }

  if (!runtimeState.anonymousEnabled) {
    return;
  }

  void initializeAnonymousTelemetry({
    endpoint: getAnonymousTelemetryEndpoint(),
    clientDailyActivityEndpoint: getClientDailyActivityEndpoint(),
    telemetryMode: runtimeState.telemetryMode,
  }).catch((error) => {
    warnStartupFailure(
      "anonymous_telemetry",
      "Failed to initialize anonymous telemetry",
      error,
    );
  });
}

let telemetryStarted = false;

function startTelemetryOnce(): void {
  if (telemetryStarted) {
    return;
  }
  telemetryStarted = true;

  try {
    recordRendererStartupEvent("telemetry.start");
    initializeDesktopTelemetry();
    recordRendererStartupEvent("telemetry.completed");
  } catch (error) {
    recordRendererStartupEvent("telemetry.failed");
    warnStartupFailure(
      "desktop_telemetry",
      "Failed to initialize desktop telemetry",
      error,
    );
  }

  recordRendererStartupEvent("anonymous_telemetry.start");
  startAnonymousTelemetry();
}

async function bootstrapApiConfigForStartup(): Promise<boolean> {
  recordRendererStartupEvent("api_config.start");
  const bootstrapPromise = bootstrapProliferateApiConfig()
    .then(() => {
      recordRendererStartupEvent("api_config.completed");
      return true;
    })
    .catch((error) => {
      // Fall back to env/default resolution when no runtime override is available.
      recordRendererStartupEvent("api_config.failed");
      warnStartupFailure(
        "api_config",
        "Failed to bootstrap Proliferate API config",
        error,
      );
      return true;
    });

  const completedBeforeBudget = await Promise.race([
    bootstrapPromise,
    new Promise<false>((resolve) => {
      window.setTimeout(() => resolve(false), API_CONFIG_STARTUP_BUDGET_MS);
    }),
  ]);

  if (!completedBeforeBudget) {
    recordRendererStartupEvent("api_config.timeout");
    void bootstrapPromise.then(() => {
      startTelemetryOnce();
    });
  }

  return completedBeforeBudget;
}

void (async () => {
  recordRendererStartupEvent("startup.start");
  const apiConfigReady = await bootstrapApiConfigForStartup();
  if (apiConfigReady) {
    startTelemetryOnce();
  }

  renderAppOnce();
  recordRendererStartupEvent("startup.completed");
})().catch((error) => {
  recordRendererStartupEvent("startup.failed");
  warnStartupFailure("desktop_startup", "Failed to start desktop app", error);
  renderAppOnce();
});
