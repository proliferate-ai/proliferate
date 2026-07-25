import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { initializeTheme } from "./config/theme";
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
import { startLayoutShiftObserver } from "./lib/infra/measurement/debug-layout-shift";
import { logRendererEvent } from "./lib/access/tauri/diagnostics";
import { getStoredAuthSession } from "./lib/access/tauri/auth";
import { isDevAuthBypassed } from "./lib/domain/auth/auth-mode";
import { desktopAuthCoordinator } from "./lib/integrations/auth/auth-coordinator-instance";
import { AppProviders } from "./providers/AppProviders";
import "./index.css";

const IS_TAURI_DESKTOP =
  typeof window !== "undefined"
  && "__TAURI_INTERNALS__" in (window as unknown as Record<string, unknown>);
const API_CONFIG_STARTUP_BUDGET_MS = 1500;
const AUTH_AUTHORITY_STARTUP_BUDGET_MS = 700;

document.documentElement.dataset.proliferateClient = "desktop";
initializeTheme();

const rendererStartupStartedAt = startStartupTimer();
installWebKitPerformanceMeasureDetailGuard();
installBootStallDiagnostics();
installDebugMeasurement();
startLayoutShiftObserver();

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

// Resolve the initial session authority BEFORE the first render so no remote
// provider ever mounts without a resolved authority (spec §5.1/§5.2): the
// stored session yields a provisional user authority, otherwise anonymous.
// Bootstrap validation later confirms it (same generation), replaces it
// (generation advance), or marks it unreachable (retained). On a slow/failed
// keychain read we resolve anonymous; a stored session found afterwards is a
// normal authority replacement.
async function resolveInitialAuthorityForStartup(): Promise<void> {
  recordRendererStartupEvent("auth_authority.start");
  try {
    const stored = isDevAuthBypassed()
      ? null
      : await Promise.race([
        getStoredAuthSession(),
        new Promise<null>((resolve) => {
          window.setTimeout(() => resolve(null), AUTH_AUTHORITY_STARTUP_BUDGET_MS);
        }),
      ]);
    await desktopAuthCoordinator.resolveProvisionalAuthority(stored);
    recordRendererStartupEvent("auth_authority.completed");
  } catch (error) {
    await desktopAuthCoordinator.resolveProvisionalAuthority(null);
    recordRendererStartupEvent("auth_authority.failed");
    warnStartupFailure("Failed to resolve initial auth authority", error);
  }
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

  await resolveInitialAuthorityForStartup();

  renderAppOnce();
  recordRendererStartupEvent("startup.completed");
})().catch((error) => {
  recordRendererStartupEvent("startup.failed");
  warnStartupFailure("Failed to start desktop app", error);
  void desktopAuthCoordinator.resolveProvisionalAuthority(null).finally(() => {
    renderAppOnce();
  });
});
