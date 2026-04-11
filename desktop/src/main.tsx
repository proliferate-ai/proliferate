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
import { AppProviders } from "./providers/AppProviders";
import "./index.css";

const IS_TAURI_DESKTOP =
  typeof window !== "undefined"
  && "__TAURI_INTERNALS__" in (window as unknown as Record<string, unknown>);

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
}

void (async () => {
  try {
    await bootstrapProliferateApiConfig();
  } catch {
    // Fall back to env/default resolution when no runtime override is available.
  }

  initializeDesktopTelemetry();

  const runtimeState = getDesktopTelemetryRuntimeState();
  if (runtimeState.anonymousEnabled) {
    try {
      await initializeAnonymousTelemetry({
        endpoint: getAnonymousTelemetryEndpoint(),
        telemetryMode: runtimeState.telemetryMode,
      });
    } catch (error) {
      if (import.meta.env.DEV) {
        console.warn("Failed to initialize anonymous telemetry", error);
      }
    }
  }

  renderApp();
})();
