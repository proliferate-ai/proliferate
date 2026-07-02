import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  clearAgentRouteSelection,
  createAgentApiKey,
  deleteAgentCatalogOverride,
  getAgentCatalog,
  getAgentGatewayCapabilities,
  getAgentGatewayEnrollment,
  listAgentApiKeys,
  listAgentRouteSelections,
  refreshAgentCatalog,
  revokeAgentApiKey,
  upsertAgentCatalogOverride,
  upsertAgentRouteSelection,
  type AgentApiKey,
  type AgentApiKeyListResponse,
  type AgentAuthRoute,
  type AgentAuthRouteSelection,
  type AgentAuthRouteSelectionListResponse,
  type AgentAuthSurface,
  type AgentGatewayCapabilities,
  type AgentGatewayCatalog,
  type AgentGatewayCatalogOverride,
  type AgentGatewayEnrollment,
  type CreateAgentApiKeyRequest,
  type RefreshAgentGatewayCatalogRequest,
  type UpsertAgentAuthRouteSelectionRequest,
  type UpsertAgentGatewayCatalogOverrideRequest,
} from "@proliferate/cloud-sdk";
import { useCloudClient } from "../context/CloudClientProvider.js";
import {
  agentApiKeysKey,
  agentGatewayCapabilitiesKey,
  agentGatewayCatalogKey,
  agentGatewayCatalogRootKey,
  agentGatewayEnrollmentKey,
  agentRouteSelectionsKey,
} from "../lib/query-keys.js";

export interface UpsertRouteSelectionInput {
  harnessKind: string;
  surface: string;
  body: UpsertAgentAuthRouteSelectionRequest;
}

export interface ClearRouteSelectionInput {
  harnessKind: string;
  surface: string;
  /** Slot to clear; defaults to 'primary' (single-source harnesses). */
  slot?: string;
}

export interface AgentCatalogScope {
  harnessKind: string;
  surface: AgentAuthSurface;
  route?: AgentAuthRoute;
}

export interface RefreshAgentCatalogInput {
  harnessKind: string;
  body: RefreshAgentGatewayCatalogRequest;
}

export interface UpsertCatalogOverrideInput {
  harnessKind: string;
  body: UpsertAgentGatewayCatalogOverrideRequest;
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
    mutationFn: ({ harnessKind, surface, slot }) =>
      clearAgentRouteSelection(harnessKind, surface, slot ?? "primary", client),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: agentRouteSelectionsKey() });
    },
  });
}

export function useAgentCatalog(scope: AgentCatalogScope, enabled = true) {
  const client = useCloudClient();
  const route = scope.route ?? "gateway";
  return useQuery<AgentGatewayCatalog>({
    queryKey: agentGatewayCatalogKey(scope.harnessKind, scope.surface, route),
    queryFn: () => getAgentCatalog(scope.harnessKind, scope.surface, route, client),
    enabled,
  });
}

export function useRefreshAgentCatalog() {
  const client = useCloudClient();
  const queryClient = useQueryClient();
  return useMutation<AgentGatewayCatalog, Error, RefreshAgentCatalogInput>({
    mutationFn: ({ harnessKind, body }) => refreshAgentCatalog(harnessKind, body, client),
    onSuccess: (data, { harnessKind, body }) => {
      queryClient.setQueryData(
        agentGatewayCatalogKey(harnessKind, body.surface, body.route),
        data,
      );
    },
  });
}

export function useUpsertCatalogOverride() {
  const client = useCloudClient();
  const queryClient = useQueryClient();
  return useMutation<AgentGatewayCatalogOverride, Error, UpsertCatalogOverrideInput>({
    mutationFn: ({ harnessKind, body }) =>
      upsertAgentCatalogOverride(harnessKind, body, client),
    onSuccess: () => {
      // Overrides are per-harness and layer over every (surface, route) view.
      void queryClient.invalidateQueries({ queryKey: agentGatewayCatalogRootKey() });
    },
  });
}

export function useDeleteCatalogOverride() {
  const client = useCloudClient();
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (harnessKind) => deleteAgentCatalogOverride(harnessKind, client),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: agentGatewayCatalogRootKey() });
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
