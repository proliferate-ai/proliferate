import { getAnyHarnessClient } from "@anyharness/sdk-react";
import type {
  DesktopRuntimeBridge,
  LocalRuntimeSnapshot,
} from "@proliferate/product-client/host/desktop-bridge";
// Narrow bootstrap wiring: this module is the canonical boot orchestrator for
// AnyHarness runtime connection state.
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";
import { DEFAULT_RUNTIME_URL } from "@/config/runtime";

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
    useHarnessConnectionStore.setState({ connectionState: "connecting", error: null });
    setRuntimeUrlIfChanged(DEFAULT_RUNTIME_URL);
    await pollUntilHealthy(runtime, DEFAULT_RUNTIME_URL, signal);
  }
}

export async function restartHarnessRuntime(
  runtime: DesktopRuntimeBridge,
): Promise<void> {
  try {
    await connectToRuntime(runtime, () => runtime.restart());
  } catch (error) {
    useHarnessConnectionStore.setState({ connectionState: "failed", error: String(error) });
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
  useHarnessConnectionStore.setState({ connectionState: "connecting", error: null });

  const snapshot = await getRuntimeSnapshot();
  if (signal?.aborted) {
    return;
  }
  const runtimeUrl = snapshot.connection.runtimeUrl;
  setRuntimeUrlIfChanged(runtimeUrl);

  const runtimeReady = await confirmRuntimeReady(runtimeUrl);
  if (signal?.aborted) {
    return;
  }
  if (runtimeReady) {
    useHarnessConnectionStore.setState({ connectionState: "healthy", error: null });
    return;
  }

  if (snapshot.status === "failed") {
    useHarnessConnectionStore.setState({
      connectionState: "failed",
      error: `Runtime status: ${snapshot.status}`,
    });
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
        useHarnessConnectionStore.setState({ runtimeUrl: currentRuntimeUrl });
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
      useHarnessConnectionStore.setState({ connectionState: "healthy", error: null });
      return;
    }
    if (runtimeSnapshot?.status === "failed") {
      useHarnessConnectionStore.setState({
        connectionState: "failed",
        error: `Runtime ${runtimeSnapshot.status}`,
      });
      return;
    }
  }
  if (signal?.aborted) {
    return;
  }
  console.error("[harness] pollUntilHealthy: gave up after %d attempts", maxAttempts);
  useHarnessConnectionStore.setState({ connectionState: "failed", error: "Runtime did not become healthy in time." });
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

function setRuntimeUrlIfChanged(runtimeUrl: string): void {
  if (useHarnessConnectionStore.getState().runtimeUrl !== runtimeUrl) {
    useHarnessConnectionStore.setState({ runtimeUrl });
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
