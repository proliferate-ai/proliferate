import { useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  createAgentRunConfig,
  deleteAgentRunConfig,
  setAgentRunConfigDefault,
  updateAgentRunConfig,
} from "@proliferate/cloud-sdk/client/agent-run-configs";
import type {
  CloudAgentRunConfig,
  CloudAgentRunConfigDefault,
  CloudAgentRunConfigDefaultOwnerSelection,
  CreateCloudAgentRunConfigRequest,
  SetCloudAgentRunConfigDefaultRequest,
  UpdateCloudAgentRunConfigRequest,
} from "@/lib/access/cloud/client";
import {
  agentRunConfigKey,
  agentRunConfigsRootKey,
} from "./query-keys";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import { requireHostCloudClient } from "@/lib/access/cloud/host-client";

export function useAgentRunConfigMutations() {
  const queryClient = useQueryClient();
  const cloudClient = useProductHost().cloud.client;

  const invalidateAgentRunConfigs = useCallback(async (configId?: string) => {
    await queryClient.invalidateQueries({ queryKey: agentRunConfigsRootKey() });
    if (configId) {
      await queryClient.invalidateQueries({ queryKey: agentRunConfigKey(configId) });
    }
  }, [queryClient]);

  const createMutation = useMutation<
    CloudAgentRunConfig,
    Error,
    CreateCloudAgentRunConfigRequest
  >({
    mutationFn: (body) => createAgentRunConfig(body, requireHostCloudClient(cloudClient)),
    onSuccess: (config) => invalidateAgentRunConfigs(config.id),
  });

  const updateMutation = useMutation<
    CloudAgentRunConfig,
    Error,
    { configId: string; body: UpdateCloudAgentRunConfigRequest }
  >({
    mutationFn: ({ configId, body }) =>
      updateAgentRunConfig(configId, body, requireHostCloudClient(cloudClient)),
    onSuccess: (config) => invalidateAgentRunConfigs(config.id),
  });

  const deleteMutation = useMutation<void, Error, string>({
    mutationFn: (configId) =>
      deleteAgentRunConfig(configId, requireHostCloudClient(cloudClient)),
    onSuccess: (_, configId) => invalidateAgentRunConfigs(configId),
  });

  const setDefaultMutation = useMutation<
    CloudAgentRunConfigDefault,
    Error,
    {
      agentKind: string;
      body: SetCloudAgentRunConfigDefaultRequest;
      options?: CloudAgentRunConfigDefaultOwnerSelection;
    }
  >({
    mutationFn: ({ agentKind, body, options }) =>
      setAgentRunConfigDefault(
        agentKind,
        body,
        options,
        requireHostCloudClient(cloudClient),
      ),
    onSuccess: () => invalidateAgentRunConfigs(),
  });

  return {
    createMutation,
    updateMutation,
    deleteMutation,
    setDefaultMutation,
    invalidateAgentRunConfigs,
  };
}
