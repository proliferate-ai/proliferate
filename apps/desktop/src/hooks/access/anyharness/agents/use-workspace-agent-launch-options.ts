import type { AgentLaunchOptionsResponse } from "@anyharness/sdk";
import {
  anyHarnessAgentLaunchOptionsKey,
  useAgentLaunchOptionsQuery,
} from "@anyharness/sdk-react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { getAgentLaunchOptions } from "@/lib/access/anyharness/agents";
import type { CloudConnectionInfo } from "@/lib/access/cloud/client";
import { withFreshManagedSandboxGatewayAccessToken } from "@/lib/access/cloud/managed-sandbox-gateway";

export function useWorkspaceAgentLaunchOptionsQuery({
  workspaceId,
  cloudConnectionInfo,
}: {
  workspaceId: string | null;
  cloudConnectionInfo?: CloudConnectionInfo | null;
}): UseQueryResult<AgentLaunchOptionsResponse> {
  const localQuery = useAgentLaunchOptionsQuery({
    workspaceId,
    enabled: !cloudConnectionInfo,
  });
  const gatewayRuntimeUrl = cloudConnectionInfo?.runtimeUrl ?? "";
  const gatewayWorkspaceId = cloudConnectionInfo?.anyharnessWorkspaceId ?? null;
  const gatewayQuery = useQuery({
    queryKey: anyHarnessAgentLaunchOptionsKey(
      gatewayRuntimeUrl,
      gatewayWorkspaceId,
    ),
    enabled: Boolean(cloudConnectionInfo && gatewayRuntimeUrl && gatewayWorkspaceId),
    queryFn: async ({ signal }) => {
      if (!cloudConnectionInfo) {
        throw new Error("Cloud workspace connection is unavailable.");
      }
      const freshConnection = await withFreshManagedSandboxGatewayAccessToken(
        cloudConnectionInfo,
      );
      return getAgentLaunchOptions(
        {
          runtimeUrl: freshConnection.runtimeUrl,
          authToken: freshConnection.accessToken ?? undefined,
        },
        freshConnection.anyharnessWorkspaceId,
        { signal },
      );
    },
  });

  return cloudConnectionInfo ? gatewayQuery : localQuery;
}
