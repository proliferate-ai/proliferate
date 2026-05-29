import { bootstrapHarnessRuntime } from "@/lib/access/anyharness/runtime-bootstrap";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";

export async function ensureRuntimeReady(): Promise<string> {
  const state = useHarnessConnectionStore.getState();
  if (state.connectionState !== "healthy" || state.runtimeUrl.trim().length === 0) {
    await bootstrapHarnessRuntime();
  }

  const readyState = useHarnessConnectionStore.getState();
  if (readyState.connectionState !== "healthy" || readyState.runtimeUrl.trim().length === 0) {
    throw new Error(readyState.error || "AnyHarness runtime is still starting. Try again.");
  }

  return readyState.runtimeUrl;
}
