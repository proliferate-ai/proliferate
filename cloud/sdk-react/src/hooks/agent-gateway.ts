import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  clearAgentRouteSelection,
  createAgentApiKey,
  getAgentGatewayCapabilities,
  getAgentGatewayEnrollment,
  getOrgAgentPolicy,
  listAgentApiKeys,
  listAgentRouteSelections,
  listOrgAgentPolicyViolations,
  revokeAgentApiKey,
  updateOrgAgentPolicy,
  upsertAgentRouteSelection,
  type AgentApiKey,
  type AgentApiKeyListResponse,
  type AgentAuthRouteSelection,
  type AgentAuthRouteSelectionListResponse,
  type AgentGatewayCapabilities,
  type AgentGatewayEnrollment,
  type CreateAgentApiKeyRequest,
  type OrgAgentPolicy,
  type OrgAgentPolicyViolationListResponse,
  type UpdateOrgAgentPolicyRequest,
  type UpsertAgentAuthRouteSelectionRequest,
} from "@proliferate/cloud-sdk";
import { useCloudClient } from "../context/CloudClientProvider.js";
import {
  agentApiKeysKey,
  agentGatewayCapabilitiesKey,
  agentGatewayEnrollmentKey,
  agentRouteSelectionsKey,
  orgAgentPolicyKey,
  orgAgentPolicyViolationsKey,
} from "../lib/query-keys.js";

export interface UpsertRouteSelectionInput {
  harnessKind: string;
  surface: string;
  body: UpsertAgentAuthRouteSelectionRequest;
}

export interface ClearRouteSelectionInput {
  harnessKind: string;
  surface: string;
}

export function useAgentApiKeys(enabled = true) {
  const client = useCloudClient();
  return useQuery<AgentApiKeyListResponse>({
    queryKey: agentApiKeysKey(),
    queryFn: () => listAgentApiKeys(client),
    enabled,
  });
}

export function useCreateAgentApiKey() {
  const client = useCloudClient();
  const queryClient = useQueryClient();
  return useMutation<AgentApiKey, Error, CreateAgentApiKeyRequest>({
    mutationFn: (input) => createAgentApiKey(input, client),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: agentApiKeysKey() });
    },
  });
}

export function useRevokeAgentApiKey() {
  const client = useCloudClient();
  const queryClient = useQueryClient();
  return useMutation<AgentApiKey, Error, string>({
    mutationFn: (keyId) => revokeAgentApiKey(keyId, client),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: agentApiKeysKey() });
      // Revoking a key can invalidate api_key route selections downstream.
      void queryClient.invalidateQueries({ queryKey: agentRouteSelectionsKey() });
    },
  });
}

export function useRouteSelections(enabled = true) {
  const client = useCloudClient();
  return useQuery<AgentAuthRouteSelectionListResponse>({
    queryKey: agentRouteSelectionsKey(),
    queryFn: () => listAgentRouteSelections(client),
    enabled,
  });
}

export function useUpsertRouteSelection() {
  const client = useCloudClient();
  const queryClient = useQueryClient();
  return useMutation<AgentAuthRouteSelection, Error, UpsertRouteSelectionInput>({
    mutationFn: ({ harnessKind, surface, body }) =>
      upsertAgentRouteSelection(harnessKind, surface, body, client),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: agentRouteSelectionsKey() });
    },
  });
}

export function useClearRouteSelection() {
  const client = useCloudClient();
  const queryClient = useQueryClient();
  return useMutation<void, Error, ClearRouteSelectionInput>({
    mutationFn: ({ harnessKind, surface }) =>
      clearAgentRouteSelection(harnessKind, surface, client),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: agentRouteSelectionsKey() });
    },
  });
}

export function useAgentGatewayCapabilities(enabled = true) {
  const client = useCloudClient();
  return useQuery<AgentGatewayCapabilities>({
    queryKey: agentGatewayCapabilitiesKey(),
    queryFn: () => getAgentGatewayCapabilities(client),
    enabled,
    staleTime: 5 * 60 * 1000,
  });
}

export function useAgentGatewayEnrollment(enabled = true) {
  const client = useCloudClient();
  return useQuery<AgentGatewayEnrollment>({
    queryKey: agentGatewayEnrollmentKey(),
    queryFn: () => getAgentGatewayEnrollment(client),
    enabled,
  });
}

export function useOrgAgentPolicy(organizationId: string | null, enabled = true) {
  const client = useCloudClient();
  return useQuery<OrgAgentPolicy>({
    queryKey: orgAgentPolicyKey(organizationId ?? "none"),
    queryFn: () => getOrgAgentPolicy(organizationId ?? "", client),
    enabled: enabled && organizationId !== null,
  });
}

export function useUpdateOrgAgentPolicy(organizationId: string | null) {
  const client = useCloudClient();
  const queryClient = useQueryClient();
  return useMutation<OrgAgentPolicy, Error, UpdateOrgAgentPolicyRequest>({
    mutationFn: (input) => {
      if (!organizationId) {
        return Promise.reject(new Error("No organization selected."));
      }
      return updateOrgAgentPolicy(organizationId, input, client);
    },
    onSuccess: () => {
      if (!organizationId) {
        return;
      }
      void queryClient.invalidateQueries({
        queryKey: orgAgentPolicyKey(organizationId),
      });
    },
  });
}

export function useOrgAgentPolicyViolations(
  organizationId: string | null,
  enabled = true,
) {
  const client = useCloudClient();
  return useQuery<OrgAgentPolicyViolationListResponse>({
    queryKey: orgAgentPolicyViolationsKey(organizationId ?? "none"),
    queryFn: () => listOrgAgentPolicyViolations(organizationId ?? "", client),
    enabled: enabled && organizationId !== null,
  });
}
