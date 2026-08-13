import { getAnyHarnessClient } from "@anyharness/sdk-react";
import type {
  DesktopRuntimeBridge,
  LocalRuntimeSnapshot,
} from "@proliferate/product-client/host/desktop-bridge";
import {
  diagnosticField,
  recordRendererDiagnostic,
} from "#product/lib/infra/diagnostics/renderer-diagnostics-port";
import { recordRuntimeConnectionState } from "#product/lib/infra/diagnostics/renderer-diagnostic-migrations";
import type { HarnessConnectionState } from "#product/stores/sessions/session-types";
// Narrow bootstrap wiring: this module is the canonical boot orchestrator for
// AnyHarness runtime connection state.
import {
  useHarnessConnectionStore,
  type HarnessRuntimeUrlSource,
} from "#product/stores/sessions/harness-connection-store";
import { DEFAULT_RUNTIME_URL } from "#product/config/runtime";

let runtimeConnectionStateEnteredAt: number | null = null;

/**
 * Single writer for `connectionState`, so the diagnostics record fires on state
 * TRANSITIONS only. pollUntilHealthy re-enters the healthy/failed branches on a
 * 500ms cadence for up to 120 attempts; recording per iteration would reproduce
 * exactly the startup-debug flood this pass exists to remove.
 */
function setRuntimeConnectionState(
  connectionState: HarnessConnectionState,
  error: string | null,
): void {
  const previous = useHarnessConnectionStore.getState().connectionState;
  useHarnessConnectionStore.setState({ connectionState, error });
  if (previous === connectionState) {
    return;
  }
  const enteredAt = runtimeConnectionStateEnteredAt;
  const now = performance.now();
  runtimeConnectionStateEnteredAt = now;
  recordRuntimeConnectionState({
    state: connectionState,
    elapsedMs: enteredAt === null ? 0 : Math.round(now - enteredAt),
  });
}

export async function bootstrapHarnessRuntime(
  runtime: DesktopRuntimeBridge,
  signal?: AbortSignal,
): Promise<void> {
  try {
    await connectToRuntime(runtime, () => runtime.getConnection(), signal);
  } catch {
    if (signal?.aborted) {
      return;
    }
    // Tauri commands unavailable (e.g. dev mode) — try fallback URL
    setRuntimeConnectionState("connecting", null);
    setRuntimeUrlIfChanged(DEFAULT_RUNTIME_URL, "default_fallback");
    await pollUntilHealthy(runtime, DEFAULT_RUNTIME_URL, signal);
  }
}

export async function restartHarnessRuntime(
  runtime: DesktopRuntimeBridge,
): Promise<void> {
  try {
    await connectToRuntime(runtime, () => runtime.restart());
  } catch (error) {
    setRuntimeConnectionState("failed", String(error));
  }
}

async function connectToRuntime(
  runtime: DesktopRuntimeBridge,
  getRuntimeSnapshot: () => Promise<LocalRuntimeSnapshot>,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) {
    return;
  }
  setRuntimeConnectionState("connecting", null);

  const snapshot = await getRuntimeSnapshot();
  if (signal?.aborted) {
    return;
  }
  const runtimeUrl = snapshot.connection.runtimeUrl;
  setRuntimeUrlIfChanged(runtimeUrl, "native_capture");

  const runtimeReady = await confirmRuntimeReady(runtimeUrl);
  if (signal?.aborted) {
    return;
  }
  if (runtimeReady) {
    setRuntimeConnectionState("healthy", null);
    return;
  }

  if (snapshot.status === "failed") {
    setRuntimeConnectionState("failed", `Runtime status: ${snapshot.status}`);
    return;
  }

  await pollUntilHealthy(runtime, runtimeUrl, signal);
}

async function pollUntilHealthy(
  runtime: DesktopRuntimeBridge,
  seedRuntimeUrl?: string,
  signal?: AbortSignal,
): Promise<void> {
  const maxAttempts = 120;
  let currentRuntimeUrl = seedRuntimeUrl ?? useHarnessConnectionStore.getState().runtimeUrl;

  for (let i = 0; i < maxAttempts; i += 1) {
    if (!await waitForPollInterval(signal)) {
      return;
    }
    let runtimeSnapshot: LocalRuntimeSnapshot | null = null;
    try {
      runtimeSnapshot = await runtime.getConnection();
      if (signal?.aborted) {
        return;
      }
      if (runtimeSnapshot.connection.runtimeUrl !== currentRuntimeUrl) {
        currentRuntimeUrl = runtimeSnapshot.connection.runtimeUrl;
        useHarnessConnectionStore.setState({
          runtimeUrl: currentRuntimeUrl,
          runtimeUrlSource: "native_capture",
        });
      }
    } catch {
      if (signal?.aborted) {
        return;
      }
      runtimeSnapshot = null;
    }

    const runtimeReady = currentRuntimeUrl
      ? await confirmRuntimeReady(currentRuntimeUrl)
      : false;
    if (signal?.aborted) {
      return;
    }
    if (runtimeReady) {
      setRuntimeConnectionState("healthy", null);
      return;
    }
    if (runtimeSnapshot?.status === "failed") {
      setRuntimeConnectionState("failed", `Runtime ${runtimeSnapshot.status}`);
      return;
    }
  }
  if (signal?.aborted) {
    return;
  }
  recordRendererDiagnostic({
    name: "renderer.runtime.health_poll_exhausted",
    severity: "error",
    kind: "message",
    privacy: "operational",
    fields: {
      max_attempts: diagnosticField(maxAttempts, "operational"),
    },
    errorClassification: "runtime_health_poll_exhausted",
  });
  console.error("[harness] pollUntilHealthy: gave up after %d attempts", maxAttempts);
  setRuntimeConnectionState("failed", "Runtime did not become healthy in time.");
}

function waitForPollInterval(signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) {
    return Promise.resolve(false);
  }

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", handleAbort);
      resolve(true);
    }, 500);
    const handleAbort = () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", handleAbort);
      resolve(false);
    };
    signal?.addEventListener("abort", handleAbort, { once: true });
  });
}

function setRuntimeUrlIfChanged(
  runtimeUrl: string,
  runtimeUrlSource: HarnessRuntimeUrlSource,
): void {
  const state = useHarnessConnectionStore.getState();
  if (state.runtimeUrl !== runtimeUrl || state.runtimeUrlSource !== runtimeUrlSource) {
    useHarnessConnectionStore.setState({ runtimeUrl, runtimeUrlSource });
  }
}

async function confirmRuntimeReady(runtimeUrl: string): Promise<boolean> {
  try {
    await getAnyHarnessClient({ runtimeUrl }).runtime.getHealth();
    return true;
  } catch {
    return false;
  }
}
