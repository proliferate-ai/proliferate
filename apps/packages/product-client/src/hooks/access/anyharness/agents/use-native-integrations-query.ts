import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getAnyHarnessClient, useAnyHarnessCacheScopeKey } from "@anyharness/sdk-react";
import { useHarnessConnectionStore } from "#product/stores/sessions/harness-connection-store";

/**
 * Access to one harness's native integrations (native-integrations.md): the
 * listing read and the one selection write, with their shared cache entry.
 * Local surface only — discovery is a fact about this machine's harness
 * install, so both hooks gate on the local runtime being healthy and callers
 * gate on `surface === "local"` via `enabled`. Presentation lives in the
 * derived hook (`use-native-integrations`); this layer only moves the wire
 * shapes.
 */

export function nativeIntegrationsKey(
  runtimeUrl: string,
  cacheScopeKey: string,
  harnessKind: string,
) {
  return [
    "anyharness",
    cacheScopeKey,
    runtimeUrl,
    "agents",
    harnessKind,
    "native-integrations",
  ] as const;
}

export function useNativeIntegrationsQuery(harnessKind: string, enabled: boolean) {
  const cacheScopeKey = useAnyHarnessCacheScopeKey();
  const runtimeUrl = useHarnessConnectionStore((state) => state.runtimeUrl);
  const connectionState = useHarnessConnectionStore((state) => state.connectionState);
  const runtimeHealthy = connectionState === "healthy" && runtimeUrl.trim().length > 0;

  return useQuery({
    queryKey: nativeIntegrationsKey(runtimeUrl, cacheScopeKey, harnessKind),
    enabled: enabled && runtimeHealthy,
    queryFn: ({ signal }) =>
      getAnyHarnessClient({ runtimeUrl }).agents.listNativeIntegrations(harnessKind, { signal }),
  });
}

export interface NativeIntegrationSelectionInput {
  integrationId: string;
  enabled: boolean;
}

/**
 * `PUT .../native-integrations/{id}`. The runtime answers with the refreshed
 * listing, which becomes the cache entry directly — the section never renders
 * a selection the runtime has not accepted. The follow-up invalidate only
 * re-arms observers in case a concurrent write landed between the two.
 */
export function useNativeIntegrationSelectionMutation(harnessKind: string) {
  const cacheScopeKey = useAnyHarnessCacheScopeKey();
  const runtimeUrl = useHarnessConnectionStore((state) => state.runtimeUrl);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: NativeIntegrationSelectionInput) =>
      getAnyHarnessClient({ runtimeUrl }).agents.setNativeIntegrationSelection(
        harnessKind,
        input.integrationId,
        input.enabled,
      ),
    onSuccess: async (response) => {
      const key = nativeIntegrationsKey(runtimeUrl, cacheScopeKey, harnessKind);
      queryClient.setQueryData(key, response);
      await queryClient.invalidateQueries({ queryKey: key });
    },
  });
}
