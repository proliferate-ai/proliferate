import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
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
  recordBootDiagnostic,
} from "./lib/infra/measurement/boot-stall-diagnostics";
import { installDebugMeasurement } from "./lib/infra/measurement/debug-measurement-install";
import { logRendererEvent } from "./lib/access/tauri/diagnostics";
import { AppProviders } from "./providers/AppProviders";
import "./index.css";

const IS_TAURI_DESKTOP =
  typeof window !== "undefined"
  && "__TAURI_INTERNALS__" in (window as unknown as Record<string, unknown>);
const API_CONFIG_STARTUP_BUDGET_MS = 1500;

const rendererStartupStartedAt = startStartupTimer();
installWebKitPerformanceMeasureDetailGuard();
installBootStallDiagnostics();
installDebugMeasurement();

function recordRendererStartupEvent(message: string): void {
  recordBootDiagnostic(`renderer_startup.${message}`);
  void logRendererEvent({
    source: "renderer_startup",
    message,
    elapsedMs: elapsedStartupMs(rendererStartupStartedAt),
  }).catch(() => {
    // Native logging is diagnostic-only; app startup should never depend on it.
  });
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
        <AppProviders>
          <App />
        </AppProviders>
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

function warnStartupFailure(message: string, error: unknown): void {
  if (import.meta.env.DEV) {
    console.warn(message, error);
  }
}

function startAnonymousTelemetry(): void {
  let runtimeState: ReturnType<typeof getDesktopTelemetryRuntimeState>;
  try {
    runtimeState = getDesktopTelemetryRuntimeState();
  } catch (error) {
    warnStartupFailure("Failed to resolve desktop telemetry runtime state", error);
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
    warnStartupFailure("Failed to initialize anonymous telemetry", error);
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
    warnStartupFailure("Failed to initialize desktop telemetry", error);
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
      warnStartupFailure("Failed to bootstrap Proliferate API config", error);
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
  warnStartupFailure("Failed to start desktop app", error);
  renderAppOnce();
});
