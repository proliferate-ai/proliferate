import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createAgentApiKey,
  deleteAgentCatalogOverride,
  getAgentAuthState,
  getAgentCatalog,
  getAgentGatewayCapabilities,
  getAgentGatewayEnrollment,
  getOrgAgentPolicy,
  listAgentApiKeys,
  listAuthSelections,
  listOrgAgentPolicyViolations,
  mirrorAgentCatalog,
  putAuthSelections,
  refreshAgentCatalog,
  revokeAgentApiKey,
  updateOrgAgentPolicy,
  upsertAgentCatalogOverride,
  type AgentApiKey,
  type AgentAuthRoute,
  type AgentAuthSelection,
  type AgentAuthState,
  type AgentAuthSurface,
  type AgentGatewayCapabilities,
  type AgentGatewayCatalog,
  type AgentGatewayCatalogOverride,
  type AgentGatewayEnrollment,
  type CreateAgentApiKeyRequest,
  type MirrorAgentGatewayCatalogRequest,
  type OrgAgentPolicy,
  type OrgAgentPolicyViolationListResponse,
  type PutAuthSelectionsRequest,
  type RefreshAgentGatewayCatalogRequest,
  type UpdateOrgAgentPolicyRequest,
  type UpsertAgentGatewayCatalogOverrideRequest,
} from "@proliferate/cloud-sdk";
import { useCloudClient } from "../context/CloudClientProvider.js";
import {
  agentApiKeysKey,
  agentAuthSelectionsKey,
  agentAuthSelectionsRootKey,
  agentAuthStateKey,
  agentAuthStateRootKey,
  agentGatewayCapabilitiesKey,
  agentGatewayCatalogKey,
  agentGatewayCatalogRootKey,
  agentGatewayEnrollmentKey,
  orgAgentPolicyKey,
  orgAgentPolicyViolationsKey,
} from "../lib/query-keys.js";

export interface PutAuthSelectionsInput {
  harnessKind: string;
  surface: AgentAuthSurface;
  body: PutAuthSelectionsRequest;
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

export interface MirrorAgentCatalogInput {
  harnessKind: string;
  body: MirrorAgentGatewayCatalogRequest;
}

export interface UpsertCatalogOverrideInput {
  harnessKind: string;
  body: UpsertAgentGatewayCatalogOverrideRequest;
}

// --- Key vault -------------------------------------------------------------

export function useAgentApiKeys(enabled = true) {
  const client = useCloudClient();
  return useQuery<AgentApiKey[]>({
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
      // Revoking a key can invalidate api_key selections downstream.
      void queryClient.invalidateQueries({ queryKey: agentAuthSelectionsRootKey() });
      void queryClient.invalidateQueries({ queryKey: agentAuthStateRootKey() });
    },
  });
}

// --- Auth selections -------------------------------------------------------

export function useAuthSelections(
  surface: AgentAuthSurface | null = null,
  enabled = true,
) {
  const client = useCloudClient();
  return useQuery<AgentAuthSelection[]>({
    queryKey: agentAuthSelectionsKey(surface),
    queryFn: () => listAuthSelections(surface ?? undefined, client),
    enabled,
  });
}

/**
 * The caller's rendered state.json document for one surface. The payload
 * carries the user's OWN decrypted key material (state.json contract), so it
 * exists for the local-writer sync path — not for display surfaces.
 */
export function useAgentAuthState(surface: AgentAuthSurface, enabled = true) {
  const client = useCloudClient();
  return useQuery<AgentAuthState>({
    queryKey: agentAuthStateKey(surface),
    queryFn: () => getAgentAuthState(surface, client),
    enabled,
  });
}

export function usePutAuthSelections() {
  const client = useCloudClient();
  const queryClient = useQueryClient();
  return useMutation<AgentAuthSelection[], Error, PutAuthSelectionsInput>({
    mutationFn: ({ harnessKind, surface, body }) =>
      putAuthSelections(harnessKind, surface, body, client),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: agentAuthSelectionsRootKey() });
      void queryClient.invalidateQueries({ queryKey: agentAuthStateRootKey() });
    },
  });
}

// --- Catalog ---------------------------------------------------------------

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

/**
 * Push a runtime-resolved gateway-probe result to the cloud mirror (contract
 * §4). The runtime itself holds no cloud session, so the desktop — the only
 * process here with an authenticated cloud client — calls this on the
 * runtime's behalf whenever it observes a fresh probe (see the desktop's
 * `useGatewayCatalogMirrorSync`). Not signed in => the caller simply never
 * invokes this; there is nothing to gate here.
 */
export function useMirrorAgentCatalog() {
  const client = useCloudClient();
  const queryClient = useQueryClient();
  return useMutation<AgentGatewayCatalog, Error, MirrorAgentCatalogInput>({
    mutationFn: ({ harnessKind, body }) => mirrorAgentCatalog(harnessKind, body, client),
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

// --- Capabilities + enrollment --------------------------------------------

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

// --- Org policy ------------------------------------------------------------

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
