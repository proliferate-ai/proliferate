import "@/lib/access/cloud/client";
import { useQuery } from "@tanstack/react-query";
import {
  getAgentRunConfig,
  listAgentRunConfigDefaults,
  listAgentRunConfigs,
} from "@proliferate/cloud-sdk/client/agent-run-configs";
import type {
  CloudAgentRunConfig,
  CloudAgentRunConfigDefaultOwnerSelection,
  CloudAgentRunConfigDefaultsResponse,
  CloudAgentRunConfigListResponse,
  ListCloudAgentRunConfigsOptions,
} from "@/lib/access/cloud/client";
import { useCloudAvailabilityState } from "@/hooks/cloud/derived/use-cloud-availability-state";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import {
  agentRunConfigDefaultsKey,
  agentRunConfigKey,
  agentRunConfigsListKey,
} from "./query-keys";

export function useAgentRunConfigs(
  options: ListCloudAgentRunConfigsOptions = {},
  enabled = true,
) {
  const { cloudActive } = useCloudAvailabilityState();
  const cloudClient = useProductHost().cloud.client;
  return useQuery<CloudAgentRunConfigListResponse>({
    queryKey: agentRunConfigsListKey(options),
    enabled: enabled && cloudActive && cloudClient !== null,
    queryFn: () => listAgentRunConfigs(options, cloudClient!),
  });
}

export function useAgentRunConfig(configId: string | null, enabled = true) {
  const { cloudActive } = useCloudAvailabilityState();
  const cloudClient = useProductHost().cloud.client;
  return useQuery<CloudAgentRunConfig>({
    queryKey: agentRunConfigKey(configId),
    enabled: enabled && cloudActive && configId !== null && cloudClient !== null,
    queryFn: () => getAgentRunConfig(configId!, cloudClient!),
  });
}

export function useAgentRunConfigDefaults(
  options: CloudAgentRunConfigDefaultOwnerSelection = {},
  enabled = true,
) {
  const { cloudActive } = useCloudAvailabilityState();
  const cloudClient = useProductHost().cloud.client;
  return useQuery<CloudAgentRunConfigDefaultsResponse>({
    queryKey: agentRunConfigDefaultsKey(options),
    enabled: enabled && cloudActive && cloudClient !== null,
    queryFn: () => listAgentRunConfigDefaults(options, cloudClient!),
  });
}
