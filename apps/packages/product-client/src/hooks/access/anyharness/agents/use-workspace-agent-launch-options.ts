import type { HarnessLaunchOptionsResponse } from "@anyharness/sdk";
import {
  anyHarnessAgentLaunchOptionsKey,
  useAgentLaunchOptionsQuery,
  useAnyHarnessCacheScopeKey,
} from "@anyharness/sdk-react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
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
