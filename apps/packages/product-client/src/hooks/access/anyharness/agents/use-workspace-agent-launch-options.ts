import type { HarnessLaunchOptionsResponse } from "@anyharness/sdk";
import {
  anyHarnessAgentLaunchOptionsKey,
  useAgentLaunchOptionsListQuery,
  useAgentLaunchOptionsQuery,
  useAnyHarnessCacheScopeKey,
} from "@anyharness/sdk-react";
import { useQueries, useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useMemo } from "react";
import { getAgentLaunchOptions } from "#product/lib/access/anyharness/agents";
import type { CloudConnectionInfo } from "@proliferate/cloud-sdk/types";
import { withFreshCloudSandboxGatewayAccessToken } from "#product/lib/access/cloud/cloud-sandbox-gateway";

export function useWorkspaceAgentLaunchOptionsQuery({
  harnessKind,
  cloudConnectionInfo,
}: {
  workspaceId: string | null;
  harnessKind: string | null;
  cloudConnectionInfo?: CloudConnectionInfo | null;
}): UseQueryResult<HarnessLaunchOptionsResponse> {
  const cacheScopeKey = useAnyHarnessCacheScopeKey();
  const localQuery = useAgentLaunchOptionsQuery({
    harnessKind,
    enabled: !cloudConnectionInfo,
  });
  const gatewayRuntimeUrl = cloudConnectionInfo?.runtimeUrl ?? "";
  const gatewayWorkspaceId = cloudConnectionInfo?.anyharnessWorkspaceId ?? null;
  const gatewayQuery = useQuery({
    queryKey: anyHarnessAgentLaunchOptionsKey(
      gatewayRuntimeUrl,
      harnessKind,
      cacheScopeKey,
    ),
    enabled: Boolean(cloudConnectionInfo && gatewayRuntimeUrl && gatewayWorkspaceId && harnessKind),
    queryFn: async ({ signal }) => {
      if (!cloudConnectionInfo) {
        throw new Error("Cloud workspace connection is unavailable.");
      }
      const freshConnection = await withFreshCloudSandboxGatewayAccessToken(
        cloudConnectionInfo,
      );
      return getAgentLaunchOptions(
        {
          runtimeUrl: freshConnection.runtimeUrl,
          authToken: freshConnection.accessToken ?? undefined,
        },
        harnessKind ?? "",
        { signal },
      );
    },
  });

  return cloudConnectionInfo ? gatewayQuery : localQuery;
}

/**
 * Launch options for several harness kinds at once, one response (or `null`
 * while unresolved/failed) per kind in request order. Shares the per-kind
 * cache entries of the single-kind query above for both the local-runtime and
 * cloud-gateway paths.
 */
export function useWorkspaceAgentsLaunchOptionsListQuery({
  harnessKinds,
  cloudConnectionInfo,
}: {
  workspaceId: string | null;
  harnessKinds: readonly string[];
  cloudConnectionInfo?: CloudConnectionInfo | null;
}): Array<HarnessLaunchOptionsResponse | null> {
  const cacheScopeKey = useAnyHarnessCacheScopeKey();
  const localEntries = useAgentLaunchOptionsListQuery({
    harnessKinds,
    enabled: !cloudConnectionInfo,
  });
  // The per-kind pending/error flags belong to a later slice; this hook still
  // answers in responses, and the entries are reference-stable, so the mapped
  // array is too.
  const localResponses = useMemo(
    () => localEntries.map((entry) => entry.data),
    [localEntries],
  );
  const gatewayRuntimeUrl = cloudConnectionInfo?.runtimeUrl ?? "";
  const gatewayWorkspaceId = cloudConnectionInfo?.anyharnessWorkspaceId ?? null;
  const gatewayResponses = useQueries({
    queries: harnessKinds.map((harnessKind) => ({
      queryKey: anyHarnessAgentLaunchOptionsKey(
        gatewayRuntimeUrl,
        harnessKind,
        cacheScopeKey,
      ),
      enabled: Boolean(
        cloudConnectionInfo && gatewayRuntimeUrl && gatewayWorkspaceId && harnessKind,
      ),
      // Additive best-effort fan-out: a kind the sandbox does not serve must
      // resolve to an absent group quickly, not retry-loop against a 404.
      retry: false,
      queryFn: async ({ signal }: { signal?: AbortSignal }) => {
        if (!cloudConnectionInfo) {
          throw new Error("Cloud workspace connection is unavailable.");
        }
        const freshConnection = await withFreshCloudSandboxGatewayAccessToken(
          cloudConnectionInfo,
        );
        return getAgentLaunchOptions(
          {
            runtimeUrl: freshConnection.runtimeUrl,
            authToken: freshConnection.accessToken ?? undefined,
          },
          harnessKind,
          { signal },
        );
      },
    })),
    combine: (results) => results.map((result) => result.data ?? null),
  });

  return cloudConnectionInfo ? gatewayResponses : localResponses;
}
