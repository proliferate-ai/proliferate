import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createAgentApiKey,
  deleteAgentModelOverride,
  getAgentAuthState,
  getAgentGatewayCapabilities,
  getAgentGatewayEnrollment,
  getAgentModels,
  getOrgAgentPolicy,
  listAgentApiKeys,
  listAuthSelections,
  listOrgAgentPolicyViolations,
  putAuthSelections,
  revokeAgentApiKey,
  updateOrgAgentPolicy,
  upsertAgentModelOverride,
  type AgentApiKey,
  type AgentAuthSelection,
  type AgentAuthState,
  type AgentAuthSurface,
  type AgentGatewayCapabilities,
  type AgentGatewayEnrollment,
  type AgentModelOverride,
  type AgentModels,
  type CreateAgentApiKeyRequest,
  type OrgAgentPolicy,
  type OrgAgentPolicyViolationListResponse,
  type PutAuthSelectionsRequest,
  type UpdateOrgAgentPolicyRequest,
  type UpsertAgentModelOverrideRequest,
} from "@proliferate/cloud-sdk";
import { useCloudClient } from "../context/CloudClientProvider.js";
import {
  agentApiKeysKey,
  agentAuthSelectionsKey,
  agentAuthSelectionsRootKey,
  agentAuthStateKey,
  agentAuthStateRootKey,
  agentGatewayCapabilitiesKey,
  agentGatewayEnrollmentKey,
  agentModelsKey,
  agentModelsRootKey,
  orgAgentPolicyKey,
  orgAgentPolicyViolationsKey,
} from "../lib/query-keys.js";

export interface PutAuthSelectionsInput {
  harnessKind: string;
  surface: AgentAuthSurface;
  body: PutAuthSelectionsRequest;
}

export interface AgentModelsScope {
  harnessKind: string;
  authContextId: string;
}

export interface UpsertAgentModelOverrideInput {
  harnessKind: string;
  body: UpsertAgentModelOverrideRequest;
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

// --- Agent models (cloud snapshot) -----------------------------------------
//
// B4 re-key (model-catalog.md §Cloud routes): the layered read is scoped by
// (harnessKind, authContextId) now, not (surface, route). `useRefreshAgentCatalog`
// and `useMirrorAgentCatalog` are DELETED, not renamed — b4's single ingest
// route (`POST /agent-models/{h}/refresh`) is Worker-authenticated
// (`authenticate_worker`), so no product client can call it; keeping a hook
// that can only 403 would be a live export aimed at a dead call (F-040). A
// manual "refresh" affordance for the settings All Models pane returns in C3
// once a real caller exists.

export function useAgentModels(scope: AgentModelsScope, enabled = true) {
  const client = useCloudClient();
  return useQuery<AgentModels>({
    queryKey: agentModelsKey(scope.harnessKind, scope.authContextId),
    queryFn: () => getAgentModels(scope.harnessKind, scope.authContextId, client),
    enabled,
  });
}

export function useUpsertAgentModelOverride() {
  const client = useCloudClient();
  const queryClient = useQueryClient();
  return useMutation<AgentModelOverride, Error, UpsertAgentModelOverrideInput>({
    mutationFn: ({ harnessKind, body }) =>
      upsertAgentModelOverride(harnessKind, body, client),
    onSuccess: () => {
      // Overrides are per-harness and layer over every auth-context view.
      void queryClient.invalidateQueries({ queryKey: agentModelsRootKey() });
    },
  });
}

export function useDeleteAgentModelOverride() {
  const client = useCloudClient();
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (harnessKind) => deleteAgentModelOverride(harnessKind, client),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: agentModelsRootKey() });
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
