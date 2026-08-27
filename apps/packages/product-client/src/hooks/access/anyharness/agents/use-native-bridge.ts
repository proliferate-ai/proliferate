import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAnyHarnessCacheScopeKey } from "@anyharness/sdk-react";
import {
  dismissNativeBridge,
  getNativeBridge,
} from "#product/lib/access/anyharness/agent-auth";
import { useHarnessConnectionStore } from "#product/stores/sessions/harness-connection-store";

function nativeBridgeKey(runtimeUrl: string, cacheScopeKey: string) {
  return ["anyharness", cacheScopeKey, runtimeUrl, "agent-auth", "native-bridge"] as const;
}

/**
 * The native-migration bridge read (agent_auth spec, zero-rows cutover row):
 * which harnesses on this local machine still hold the legacy flag that keeps
 * their launches on the harness's own login until the one-time settings
 * prompt is acted on. Local surface only — the bridge is machine truth and
 * never rides the wire.
 */
export function useNativeBridge(harnessKind: string, enabled: boolean) {
  const cacheScopeKey = useAnyHarnessCacheScopeKey();
  const runtimeUrl = useHarnessConnectionStore((state) => state.runtimeUrl);
  const connectionState = useHarnessConnectionStore((state) => state.connectionState);
  const runtimeHealthy = connectionState === "healthy" && runtimeUrl.trim().length > 0;
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: nativeBridgeKey(runtimeUrl, cacheScopeKey),
    enabled: enabled && runtimeHealthy,
    queryFn: ({ signal }) => getNativeBridge({ runtimeUrl }, { signal }),
  });

  const dismiss = useMutation({
    mutationFn: () => dismissNativeBridge({ runtimeUrl }, harnessKind),
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: nativeBridgeKey(runtimeUrl, cacheScopeKey),
      });
    },
  });

  return {
    /** True while this harness still holds the legacy flag. */
    pending: query.data?.harnesses.includes(harnessKind) ?? false,
    query,
    dismiss,
  };
}
