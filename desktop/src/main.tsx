import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { bootstrapProliferateApiConfig } from "./lib/infra/proliferate-api";
import { initializeAnonymousTelemetry } from "./lib/integrations/telemetry/anonymous";
import { getAnonymousTelemetryEndpoint } from "./lib/integrations/telemetry/config";
import {
  getDesktopTelemetryRuntimeState,
  getDesktopTelemetryRootHandlers,
  initializeDesktopTelemetry,
} from "./lib/integrations/telemetry/client";
import { elapsedStartupMs, startStartupTimer } from "./lib/infra/debug-startup";
import { logRendererEvent } from "./platform/tauri/diagnostics";
import { AppProviders } from "./providers/AppProviders";
import "./index.css";

const IS_TAURI_DESKTOP =
  typeof window !== "undefined"
  && "__TAURI_INTERNALS__" in (window as unknown as Record<string, unknown>);

const rendererStartupStartedAt = startStartupTimer();

function recordRendererStartupEvent(message: string): void {
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
    telemetryMode: runtimeState.telemetryMode,
  }).catch((error) => {
    warnStartupFailure("Failed to initialize anonymous telemetry", error);
  });
}

void (async () => {
  recordRendererStartupEvent("startup.start");
  renderAppOnce();

  try {
    recordRendererStartupEvent("api_config.start");
    await bootstrapProliferateApiConfig();
    recordRendererStartupEvent("api_config.completed");
  } catch (error) {
    // Fall back to env/default resolution when no runtime override is available.
    recordRendererStartupEvent("api_config.failed");
    warnStartupFailure("Failed to bootstrap Proliferate API config", error);
  }

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
  recordRendererStartupEvent("startup.completed");
})().catch((error) => {
  recordRendererStartupEvent("startup.failed");
  warnStartupFailure("Failed to start desktop app", error);
  renderAppOnce();
});
