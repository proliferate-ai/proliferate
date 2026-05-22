import { useQuery } from "@tanstack/react-query";
import {
  getAgentRunConfig,
  listAgentRunConfigs,
  type CloudAgentRunConfig,
  type CloudAgentRunConfigListResponse,
  type ListCloudAgentRunConfigsOptions,
} from "@proliferate/cloud-sdk";
import { useCloudClient } from "../context/CloudClientProvider.js";
import {
  agentRunConfigKey,
  agentRunConfigsListKey,
} from "../lib/query-keys.js";

export interface UseAgentRunConfigsOptions extends ListCloudAgentRunConfigsOptions {
  enabled?: boolean;
}

export function useAgentRunConfigs(options: UseAgentRunConfigsOptions = {}) {
  const client = useCloudClient();
  const { enabled = true, ...listOptions } = options;
  return useQuery<CloudAgentRunConfigListResponse>({
    queryKey: agentRunConfigsListKey(listOptions),
    queryFn: () => listAgentRunConfigs(listOptions, client),
    enabled,
  });
}

export function useAgentRunConfig(configId: string | null, enabled = true) {
  const client = useCloudClient();
  return useQuery<CloudAgentRunConfig>({
    queryKey: agentRunConfigKey(configId),
    queryFn: () => getAgentRunConfig(configId!, client),
    enabled: enabled && configId !== null,
  });
}
