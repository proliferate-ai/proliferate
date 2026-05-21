import "@/lib/access/cloud/client";
import { useQuery } from "@tanstack/react-query";
import {
  getAgentRunConfig,
  listAgentRunConfigs,
} from "@proliferate/cloud-sdk/client/agent-run-configs";
import type {
  CloudAgentRunConfig,
  CloudAgentRunConfigListResponse,
  ListCloudAgentRunConfigsOptions,
} from "@/lib/access/cloud/client";
import { useCloudAvailabilityState } from "@/hooks/cloud/derived/use-cloud-availability-state";
import {
  agentRunConfigKey,
  agentRunConfigsListKey,
} from "./query-keys";

export function useAgentRunConfigs(
  options: ListCloudAgentRunConfigsOptions = {},
  enabled = true,
) {
  const { cloudActive } = useCloudAvailabilityState();
  return useQuery<CloudAgentRunConfigListResponse>({
    queryKey: agentRunConfigsListKey(options),
    enabled: enabled && cloudActive,
    queryFn: () => listAgentRunConfigs(options),
  });
}

export function useAgentRunConfig(configId: string | null, enabled = true) {
  const { cloudActive } = useCloudAvailabilityState();
  return useQuery<CloudAgentRunConfig>({
    queryKey: agentRunConfigKey(configId),
    enabled: enabled && cloudActive && configId !== null,
    queryFn: () => getAgentRunConfig(configId!),
  });
}

