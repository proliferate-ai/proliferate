import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createAgentRunConfig,
  deleteAgentRunConfig,
  getAgentRunConfig,
  listAgentRunConfigDefaults,
  listAgentRunConfigs,
  setAgentRunConfigDefault,
  updateAgentRunConfig,
  type CloudAgentRunConfig,
  type CloudAgentRunConfigDefault,
  type CloudAgentRunConfigDefaultOwnerSelection,
  type CloudAgentRunConfigDefaultsResponse,
  type CloudAgentRunConfigListResponse,
  type CreateCloudAgentRunConfigRequest,
  type ListCloudAgentRunConfigsOptions,
  type SetCloudAgentRunConfigDefaultRequest,
  type UpdateCloudAgentRunConfigRequest,
} from "@proliferate/cloud-sdk";
import { useCloudClient } from "../context/CloudClientProvider.js";
import {
  agentRunConfigDefaultsKey,
  agentRunConfigKey,
  agentRunConfigsListKey,
  agentRunConfigsRootKey,
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

export interface UseAgentRunConfigDefaultsOptions
  extends CloudAgentRunConfigDefaultOwnerSelection {
  enabled?: boolean;
}

export function useAgentRunConfigDefaults(
  options: UseAgentRunConfigDefaultsOptions = {},
) {
  const client = useCloudClient();
  const { enabled = true, ...listOptions } = options;
  return useQuery<CloudAgentRunConfigDefaultsResponse>({
    queryKey: agentRunConfigDefaultsKey(listOptions),
    queryFn: () => listAgentRunConfigDefaults(listOptions, client),
    enabled,
  });
}

export interface SetAgentRunConfigDefaultInput {
  agentKind: string;
  body: SetCloudAgentRunConfigDefaultRequest;
  options?: CloudAgentRunConfigDefaultOwnerSelection;
}

export function useAgentRunConfigDefaultActions() {
  const client = useCloudClient();
  const queryClient = useQueryClient();

  const setDefaultMutation = useMutation<
    CloudAgentRunConfigDefault,
    Error,
    SetAgentRunConfigDefaultInput
  >({
    mutationFn: ({ agentKind, body, options }) =>
      setAgentRunConfigDefault(agentKind, body, options, client),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: agentRunConfigsRootKey() });
    },
  });

  return {
    setAgentRunConfigDefault: setDefaultMutation.mutateAsync,
    settingAgentRunConfigDefault: setDefaultMutation.isPending,
  };
}

export function useAgentRunConfigActions() {
  const client = useCloudClient();
  const queryClient = useQueryClient();

  const invalidateAgentRunConfigs = async (configId?: string) => {
    await queryClient.invalidateQueries({ queryKey: agentRunConfigsRootKey() });
    if (configId) {
      await queryClient.invalidateQueries({ queryKey: agentRunConfigKey(configId) });
    }
  };

  const createMutation = useMutation<
    CloudAgentRunConfig,
    Error,
    CreateCloudAgentRunConfigRequest
  >({
    mutationFn: (body) => createAgentRunConfig(body, client),
    onSuccess: (config) => invalidateAgentRunConfigs(config.id),
  });

  const updateMutation = useMutation<
    CloudAgentRunConfig,
    Error,
    { configId: string; body: UpdateCloudAgentRunConfigRequest }
  >({
    mutationFn: ({ configId, body }) => updateAgentRunConfig(configId, body, client),
    onSuccess: (config) => invalidateAgentRunConfigs(config.id),
  });

  const deleteMutation = useMutation<void, Error, string>({
    mutationFn: (configId) => deleteAgentRunConfig(configId, client),
    onSuccess: (_, configId) => invalidateAgentRunConfigs(configId),
  });

  return {
    createAgentRunConfig: createMutation.mutateAsync,
    creatingAgentRunConfig: createMutation.isPending,
    updateAgentRunConfig: updateMutation.mutateAsync,
    updatingAgentRunConfig: updateMutation.isPending,
    deleteAgentRunConfig: deleteMutation.mutateAsync,
    deletingAgentRunConfig: deleteMutation.isPending,
    invalidateAgentRunConfigs,
  };
}
