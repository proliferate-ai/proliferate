import {
  anyHarnessAgentLaunchOptionsKey,
  useAnyHarnessCacheScopeKey,
  useAnyHarnessRuntimeContext,
} from "@anyharness/sdk-react";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

/**
 * Re-issues ONE fan-out kind's launch-option read.
 *
 * The list query is a `useQueries` combine, so its entries carry no `refetch`
 * of their own — but they do share the per-kind cache entries of the
 * single-kind query, and that key is the seam a failed kind can be re-asked
 * through. Without this, a Retry offered because a FAN-OUT kind's read failed
 * would re-ask the requested kind instead, and the notice would never clear.
 */
export function useRefetchAgentLaunchOptionsKind(): (harnessKind: string) => void {
  const runtime = useAnyHarnessRuntimeContext();
  const cacheScopeKey = useAnyHarnessCacheScopeKey();
  const queryClient = useQueryClient();
  const runtimeUrl = runtime.runtimeUrl?.trim() ?? "";
  return useCallback((harnessKind: string) => {
    void queryClient.refetchQueries({
      queryKey: anyHarnessAgentLaunchOptionsKey(runtimeUrl, harnessKind, cacheScopeKey),
      exact: true,
    });
  }, [cacheScopeKey, queryClient, runtimeUrl]);
}
