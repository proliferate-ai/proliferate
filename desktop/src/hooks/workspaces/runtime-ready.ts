import { bootstrapHarnessRuntime } from "@/lib/integrations/anyharness/runtime-bootstrap";
import { useHarnessStore } from "@/stores/sessions/harness-store";

export async function ensureRuntimeReady(): Promise<string> {
  const state = useHarnessStore.getState();
  if (state.connectionState !== "healthy" || state.runtimeUrl.trim().length === 0) {
    await bootstrapHarnessRuntime();
  }

  const readyState = useHarnessStore.getState();
  if (readyState.connectionState !== "healthy" || readyState.runtimeUrl.trim().length === 0) {
    throw new Error(readyState.error || "AnyHarness runtime is still starting. Try again.");
  }

  return readyState.runtimeUrl;
}
