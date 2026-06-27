import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  cancelIntegrationOAuthFlow,
  createIntegrationAccount,
  createIntegrationDefinition,
  deleteIntegrationAccount,
  getIntegrationOAuthFlowStatus,
  listIntegrationAccounts,
  listIntegrationAvailability,
  listIntegrationDefinitions,
  listIntegrationToolMetadata,
  patchIntegrationAccount,
  startIntegrationOAuthFlow,
  type CreateIntegrationAccountRequest,
  type CreateIntegrationDefinitionRequest,
  type IntegrationAccount,
  type IntegrationAvailability,
  type IntegrationDefinition,
  type IntegrationOAuthFlowStatusResponse,
  type IntegrationToolMetadata,
  type PatchIntegrationAccountRequest,
  type StartIntegrationOAuthFlowRequest,
  type StartIntegrationOAuthFlowResponse,
} from "@proliferate/cloud-sdk";

import { useCloudClient } from "../context/CloudClientProvider.js";
import {
  cloudIntegrationAccountsKey,
  cloudIntegrationAvailabilityKey,
  cloudIntegrationDefinitionsKey,
  cloudIntegrationOAuthFlowKey,
  cloudIntegrationToolMetadataKey,
  sandboxProfileRuntimeConfigKey,
  sandboxProfileTargetStateKey,
} from "../lib/query-keys.js";

export type { IntegrationOAuthFlowStatusResponse } from "@proliferate/cloud-sdk";

const TERMINAL_OAUTH_STATUSES = new Set(["completed", "expired", "cancelled", "failed"]);

export function useIntegrationDefinitions(
  organizationId: string | null = null,
  enabled = true,
) {
  const client = useCloudClient();
  return useQuery<IntegrationDefinition[]>({
    queryKey: cloudIntegrationDefinitionsKey(organizationId),
    queryFn: () => listIntegrationDefinitions({ organizationId }, client),
    enabled,
  });
}

export function useIntegrationAccounts(enabled = true) {
  const client = useCloudClient();
  return useQuery<IntegrationAccount[]>({
    queryKey: cloudIntegrationAccountsKey(),
    queryFn: () => listIntegrationAccounts(client),
    enabled,
  });
}

export function useIntegrationAvailability(
  organizationId: string | null = null,
  enabled = true,
) {
  const client = useCloudClient();
  return useQuery<IntegrationAvailability[]>({
    queryKey: cloudIntegrationAvailabilityKey(organizationId),
    queryFn: () => listIntegrationAvailability({ organizationId }, client),
    enabled,
  });
}

export function useIntegrationToolMetadata(enabled = true) {
  const client = useCloudClient();
  return useQuery<IntegrationToolMetadata[]>({
    queryKey: cloudIntegrationToolMetadataKey(),
    queryFn: () => listIntegrationToolMetadata(client),
    enabled,
  });
}

export function useIntegrationOAuthFlowStatus(flowId: string | null, enabled = true) {
  const client = useCloudClient();
  return useQuery<IntegrationOAuthFlowStatusResponse>({
    queryKey: cloudIntegrationOAuthFlowKey(flowId),
    queryFn: () => getIntegrationOAuthFlowStatus(flowId!, client),
    enabled: enabled && flowId !== null,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status && TERMINAL_OAUTH_STATUSES.has(status) ? false : 1500;
    },
  });
}

export function useIntegrationActions() {
  const client = useCloudClient();
  const queryClient = useQueryClient();
  const invalidate = async (sandboxProfileId?: string | null) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: cloudIntegrationAccountsKey() }),
      queryClient.invalidateQueries({ queryKey: cloudIntegrationAvailabilityKey() }),
      queryClient.invalidateQueries({ queryKey: cloudIntegrationToolMetadataKey() }),
      queryClient.invalidateQueries({ queryKey: sandboxProfileTargetStateKey(sandboxProfileId ?? null) }),
      queryClient.invalidateQueries({ queryKey: sandboxProfileRuntimeConfigKey(sandboxProfileId ?? null) }),
    ]);
  };

  const createDefinition = useMutation({
    mutationFn: (body: CreateIntegrationDefinitionRequest) =>
      createIntegrationDefinition(body, client),
    onSuccess: () => invalidate(),
  });

  const createAccount = useMutation({
    mutationFn: (body: CreateIntegrationAccountRequest) => createIntegrationAccount(body, client),
    onSuccess: () => invalidate(),
  });

  const patchAccount = useMutation({
    mutationFn: (input: { accountId: string; body: PatchIntegrationAccountRequest }) =>
      patchIntegrationAccount(input.accountId, input.body, client),
    onSuccess: () => invalidate(),
  });

  const deleteAccount = useMutation({
    mutationFn: (accountId: string) => deleteIntegrationAccount(accountId, client),
    onSuccess: () => invalidate(),
  });

  const startFlow = useMutation({
    mutationFn: (input: { accountId: string; options?: StartIntegrationOAuthFlowRequest }) =>
      startIntegrationOAuthFlow(input.accountId, input.options, client),
  });

  const cancelFlow = useMutation({
    mutationFn: (flowId: string) => cancelIntegrationOAuthFlow(flowId, client),
    onSuccess: (flow) => {
      queryClient.setQueryData(cloudIntegrationOAuthFlowKey(flow.flowId), flow);
      return invalidate();
    },
  });

  return {
    createDefinition: createDefinition.mutateAsync,
    isCreatingDefinition: createDefinition.isPending,
    createAccount: createAccount.mutateAsync,
    isCreatingAccount: createAccount.isPending,
    patchAccount: patchAccount.mutateAsync,
    isPatchingAccount: patchAccount.isPending,
    deleteAccount: deleteAccount.mutateAsync,
    isDeletingAccount: deleteAccount.isPending,
    startFlow: startFlow.mutateAsync as (input: {
      accountId: string;
      options?: StartIntegrationOAuthFlowRequest;
    }) => Promise<StartIntegrationOAuthFlowResponse>,
    isStartingFlow: startFlow.isPending,
    getFlowStatus: (flowId: string) => getIntegrationOAuthFlowStatus(flowId, client),
    cancelFlow: cancelFlow.mutateAsync,
    isCancelingFlow: cancelFlow.isPending,
    invalidateIntegrations: invalidate,
  };
}
