import {
  useAgentLaunchOptionsQuery,
  useRuntimeHealthQuery,
} from "@anyharness/sdk-react";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";

export type LocalRuntimeAvailability = "connecting" | "ready" | "unavailable";

/**
 * Desktop-owned runtime connection gate for the local launch catalog.
 *
 * The generic SDK query only knows whether it has a non-empty URL. Desktop
 * starts with a fallback URL before Tauri reports the active sidecar, so local
 * settings must also wait for the connection store's healthy state.
 */
export function useLocalAgentLaunchOptions(
  enabled: boolean,
  observeSetup: boolean = enabled,
) {
  const runtimeUrl = useHarnessConnectionStore((state) => state.runtimeUrl);
  const connectionState = useHarnessConnectionStore((state) => state.connectionState);
  const runtimeReady = connectionState === "healthy" && runtimeUrl.trim().length > 0;
  const availability: LocalRuntimeAvailability = runtimeReady
    ? "ready"
    : connectionState === "failed"
      ? "unavailable"
      : "connecting";
  const query = useAgentLaunchOptionsQuery({ enabled: enabled && runtimeReady });
  const healthQuery = useRuntimeHealthQuery({
    enabled: observeSetup && runtimeReady,
    pollWhileAgentSeedHydrating: true,
  });

  return {
    query,
    availability,
    isAgentSeedHydrating: healthQuery.data?.agentSeed?.status === "hydrating",
  };
}
