import { getAnyHarnessClient } from "@anyharness/sdk-react";
import { getRuntimeInfo, type RuntimeInfo } from "@/lib/access/tauri/runtime";
import {
  restartRuntime as tauriRestartRuntime,
} from "@/lib/access/tauri/credentials";
// Narrow bootstrap wiring: this module is the canonical boot orchestrator for
// AnyHarness runtime connection state.
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";
import { DEFAULT_RUNTIME_URL } from "@/config/runtime";

export async function bootstrapHarnessRuntime(): Promise<void> {
  try {
    await connectToRuntime(getRuntimeInfo);
  } catch {
    // Tauri commands unavailable (e.g. dev mode) — try fallback URL
    useHarnessConnectionStore.setState({ connectionState: "connecting", error: null });
    setRuntimeUrlIfChanged(DEFAULT_RUNTIME_URL);
    await pollUntilHealthy(DEFAULT_RUNTIME_URL);
  }
}

export async function restartHarnessRuntime(): Promise<void> {
  try {
    await connectToRuntime(tauriRestartRuntime);
  } catch (error) {
    useHarnessConnectionStore.setState({ connectionState: "failed", error: String(error) });
  }
}

async function connectToRuntime(
  getRuntimeInfoFn: () => Promise<RuntimeInfo>,
): Promise<void> {
  useHarnessConnectionStore.setState({ connectionState: "connecting", error: null });

  const info = await getRuntimeInfoFn();
  setRuntimeUrlIfChanged(info.url);

  if (await confirmRuntimeReady(info.url)) {
    useHarnessConnectionStore.setState({ connectionState: "healthy", error: null });
    return;
  }

  if (info.status === "failed") {
    useHarnessConnectionStore.setState({
      connectionState: "failed",
      error: `Runtime status: ${info.status}`,
    });
    return;
  }

  await pollUntilHealthy(info.url);
}

async function pollUntilHealthy(seedRuntimeUrl?: string): Promise<void> {
  const maxAttempts = 120;
  let currentRuntimeUrl = seedRuntimeUrl ?? useHarnessConnectionStore.getState().runtimeUrl;

  for (let i = 0; i < maxAttempts; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    let runtimeInfo: RuntimeInfo | null = null;
    try {
      runtimeInfo = await getRuntimeInfo();
      if (runtimeInfo.url !== currentRuntimeUrl) {
        currentRuntimeUrl = runtimeInfo.url;
        useHarnessConnectionStore.setState({ runtimeUrl: runtimeInfo.url });
      }
    } catch {
      runtimeInfo = null;
    }

    if (currentRuntimeUrl && await confirmRuntimeReady(currentRuntimeUrl)) {
      useHarnessConnectionStore.setState({ connectionState: "healthy", error: null });
      return;
    }
    if (runtimeInfo?.status === "failed") {
      useHarnessConnectionStore.setState({
        connectionState: "failed",
        error: `Runtime ${runtimeInfo.status}`,
      });
      return;
    }
  }
  console.error("[harness] pollUntilHealthy: gave up after %d attempts", maxAttempts);
  useHarnessConnectionStore.setState({ connectionState: "failed", error: "Runtime did not become healthy in time." });
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
