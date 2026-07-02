import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  cancelCloudMcpOAuthFlow,
  createCloudMcpConnection,
  createConfiguredSkill,
  deleteCloudMcpConnectionV2,
  deleteConfiguredSkill,
  getCloudMcpCatalog,
  getCloudMcpOAuthFlowStatus,
  installConfiguredPlugin,
  listCloudMcpConnections,
  listConfiguredPlugins,
  listConfiguredSkills,
  patchCloudMcpConnection,
  patchConfiguredPlugin,
  patchConfiguredSkill,
  publicizeCloudMcpConnection,
  putCloudMcpSecretAuth,
  startCloudMcpOAuthFlow,
  uninstallConfiguredPlugin,
  unpublicizeCloudMcpConnection,
  type CloudMcpCatalogResponse,
  type CloudMcpConnection,
  type CloudMcpConnectionsResponse,
  type CloudMcpOAuthFlowStatusResponse,
  type CloudPluginConfiguredItem,
  type CloudPluginConfiguredItemsResponse,
  type CloudSkillConfiguredItem,
  type CloudSkillConfiguredItemsResponse,
  type CreateCloudMcpConnectionRequest,
  type CreateSkillConfiguredItemRequest,
  type PatchCloudMcpConnectionRequest,
  type PatchPluginConfiguredItemRequest,
  type PatchSkillConfiguredItemRequest,
  type PublicizeCloudMcpConnectionRequest,
  type PutCloudMcpSecretAuthRequest,
  type StartCloudMcpOAuthFlowRequest,
  type StartCloudMcpOAuthFlowResponse,
} from "@proliferate/cloud-sdk";

import { useCloudClient } from "../context/CloudClientProvider.js";
import {
  cloudConfiguredPluginsKey,
  cloudConfiguredSkillsKey,
  cloudMcpCatalogKey,
  cloudMcpConnectionsKey,
  cloudMcpOAuthFlowKey,
  cloudPluginInventoryRootKey,
  cloudTargetsKey,
  sandboxProfileRuntimeConfigKey,
} from "../lib/query-keys.js";

export type { CloudMcpOAuthFlowStatusResponse } from "@proliferate/cloud-sdk";

const TERMINAL_OAUTH_STATUSES = new Set(["completed", "expired", "cancelled", "failed"]);

export interface PluginInventoryInvalidationOptions {
  sandboxProfileId?: string | null;
  invalidateTargets?: boolean;
}

export function useCloudMcpCatalog(enabled = true) {
  const client = useCloudClient();
  return useQuery<CloudMcpCatalogResponse>({
    queryKey: cloudMcpCatalogKey(),
    queryFn: () => getCloudMcpCatalog(client),
    enabled,
  });
}

export function useCloudMcpConnections(enabled = true) {
  const client = useCloudClient();
  return useQuery<CloudMcpConnectionsResponse>({
    queryKey: cloudMcpConnectionsKey(),
    queryFn: () => listCloudMcpConnections(client),
    enabled,
  });
}

export function useCloudMcpOAuthFlowStatus(flowId: string | null, enabled = true) {
  const client = useCloudClient();
  return useQuery<CloudMcpOAuthFlowStatusResponse>({
    queryKey: cloudMcpOAuthFlowKey(flowId),
    queryFn: () => getCloudMcpOAuthFlowStatus(flowId!, client),
    enabled: enabled && flowId !== null,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status && TERMINAL_OAUTH_STATUSES.has(status) ? false : 1500;
    },
  });
}

export function useConfiguredPlugins(enabled = true) {
  const client = useCloudClient();
  return useQuery<CloudPluginConfiguredItemsResponse>({
    queryKey: cloudConfiguredPluginsKey(),
    queryFn: () => listConfiguredPlugins(client),
    enabled,
  });
}

export function useConfiguredSkills(enabled = true) {
  const client = useCloudClient();
  return useQuery<CloudSkillConfiguredItemsResponse>({
    queryKey: cloudConfiguredSkillsKey(),
    queryFn: () => listConfiguredSkills(client),
    enabled,
  });
}

export function useCloudMcpConnectionActions() {
  const client = useCloudClient();
  const queryClient = useQueryClient();
  const invalidate = (options: PluginInventoryInvalidationOptions = {}) =>
    invalidatePluginInventory(queryClient, options);

  const createConnection = useMutation({
    mutationFn: (body: CreateCloudMcpConnectionRequest) =>
      createCloudMcpConnection(body, client),
    onSuccess: () => invalidate({ invalidateTargets: true }),
  });

  const patchConnection = useMutation({
    mutationFn: (input: { connectionId: string; body: PatchCloudMcpConnectionRequest }) =>
      patchCloudMcpConnection(input.connectionId, input.body, client),
    onSuccess: () => invalidate({ invalidateTargets: true }),
  });

  const publicizeConnection = useMutation({
    mutationFn: (input: { connectionId: string; body: PublicizeCloudMcpConnectionRequest }) =>
      publicizeCloudMcpConnection(input.connectionId, input.body, client),
    onSuccess: () => invalidate({ invalidateTargets: true }),
  });

  const unpublicizeConnection = useMutation({
    mutationFn: (connectionId: string) => unpublicizeCloudMcpConnection(connectionId, client),
    onSuccess: () => invalidate({ invalidateTargets: true }),
  });

  const putSecretAuth = useMutation({
    mutationFn: (input: { connectionId: string; body: PutCloudMcpSecretAuthRequest }) =>
      putCloudMcpSecretAuth(input.connectionId, input.body, client),
    onSuccess: () => invalidate({ invalidateTargets: true }),
  });

  const deleteConnection = useMutation({
    mutationFn: (connectionId: string) => deleteCloudMcpConnectionV2(connectionId, client),
    onSuccess: () => invalidate({ invalidateTargets: true }),
  });

  return {
    createConnection: createConnection.mutateAsync,
    isCreatingConnection: createConnection.isPending,
    patchConnection: patchConnection.mutateAsync,
    isPatchingConnection: patchConnection.isPending,
    publicizeConnection: publicizeConnection.mutateAsync,
    isPublicizingConnection: publicizeConnection.isPending,
    unpublicizeConnection: unpublicizeConnection.mutateAsync,
    isUnpublicizingConnection: unpublicizeConnection.isPending,
    putSecretAuth: putSecretAuth.mutateAsync,
    isPuttingSecretAuth: putSecretAuth.isPending,
    deleteConnection: deleteConnection.mutateAsync,
    isDeletingConnection: deleteConnection.isPending,
    invalidatePluginInventory: invalidate,
  };
}

export function useCloudMcpOAuthActions() {
  const client = useCloudClient();
  const queryClient = useQueryClient();
  const invalidate = (options: PluginInventoryInvalidationOptions = {}) =>
    invalidatePluginInventory(queryClient, options);

  const startFlow = useMutation({
    mutationFn: (input: {
      connectionId: string;
      options?: StartCloudMcpOAuthFlowRequest;
    }) => startCloudMcpOAuthFlow(input.connectionId, input.options, client),
  });

  const cancelFlow = useMutation({
    mutationFn: (flowId: string) => cancelCloudMcpOAuthFlow(flowId, client),
    onSuccess: (flow) => {
      queryClient.setQueryData(cloudMcpOAuthFlowKey(flow.flowId), flow);
      return invalidate({ invalidateTargets: true });
    },
  });

  return {
    startFlow: startFlow.mutateAsync as (input: {
      connectionId: string;
      options?: StartCloudMcpOAuthFlowRequest;
    }) => Promise<StartCloudMcpOAuthFlowResponse>,
    isStartingFlow: startFlow.isPending,
    getFlowStatus: (flowId: string) => getCloudMcpOAuthFlowStatus(flowId, client),
    cancelFlow: cancelFlow.mutateAsync,
    isCancelingFlow: cancelFlow.isPending,
    invalidatePluginInventory: invalidate,
  };
}

export function useConfiguredPluginActions() {
  const client = useCloudClient();
  const queryClient = useQueryClient();
  const invalidate = (options: PluginInventoryInvalidationOptions = {}) =>
    invalidatePluginInventory(queryClient, options);

  const installPlugin = useMutation({
    mutationFn: (pluginId: string) => installConfiguredPlugin(pluginId, client),
    onSuccess: () => invalidate({ invalidateTargets: true }),
  });

  const patchPlugin = useMutation({
    mutationFn: (input: { itemId: string; body: PatchPluginConfiguredItemRequest }) =>
      patchConfiguredPlugin(input.itemId, input.body, client),
    onSuccess: () => invalidate({ invalidateTargets: true }),
  });

  const uninstallPlugin = useMutation({
    mutationFn: (itemId: string) => uninstallConfiguredPlugin(itemId, client),
    onSuccess: () => invalidate({ invalidateTargets: true }),
  });

  return {
    installPlugin: installPlugin.mutateAsync as (
      pluginId: string,
    ) => Promise<CloudPluginConfiguredItem>,
    isInstallingPlugin: installPlugin.isPending,
    patchPlugin: patchPlugin.mutateAsync,
    isPatchingPlugin: patchPlugin.isPending,
    uninstallPlugin: uninstallPlugin.mutateAsync,
    isUninstallingPlugin: uninstallPlugin.isPending,
    invalidatePluginInventory: invalidate,
  };
}

export function useConfiguredSkillActions() {
  const client = useCloudClient();
  const queryClient = useQueryClient();
  const invalidate = (options: PluginInventoryInvalidationOptions = {}) =>
    invalidatePluginInventory(queryClient, options);

  const createSkill = useMutation({
    mutationFn: (body: CreateSkillConfiguredItemRequest) =>
      createConfiguredSkill(body, client),
    onSuccess: () => invalidate({ invalidateTargets: true }),
  });

  const patchSkill = useMutation({
    mutationFn: (input: { itemId: string; body: PatchSkillConfiguredItemRequest }) =>
      patchConfiguredSkill(input.itemId, input.body, client),
    onSuccess: () => invalidate({ invalidateTargets: true }),
  });

  const deleteSkill = useMutation({
    mutationFn: (itemId: string) => deleteConfiguredSkill(itemId, client),
    onSuccess: () => invalidate({ invalidateTargets: true }),
  });

  return {
    createSkill: createSkill.mutateAsync as (
      body: CreateSkillConfiguredItemRequest,
    ) => Promise<CloudSkillConfiguredItem>,
    isCreatingSkill: createSkill.isPending,
    patchSkill: patchSkill.mutateAsync,
    isPatchingSkill: patchSkill.isPending,
    deleteSkill: deleteSkill.mutateAsync,
    isDeletingSkill: deleteSkill.isPending,
    invalidatePluginInventory: invalidate,
  };
}

async function invalidatePluginInventory(
  queryClient: ReturnType<typeof useQueryClient>,
  options: PluginInventoryInvalidationOptions,
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: cloudPluginInventoryRootKey() }),
    ...(options.invalidateTargets
      ? [queryClient.invalidateQueries({ queryKey: cloudTargetsKey() })]
      : []),
    ...(options.sandboxProfileId
      ? [
          queryClient.invalidateQueries({
            queryKey: sandboxProfileRuntimeConfigKey(options.sandboxProfileId),
          }),
        ]
      : []),
  ]);
}
