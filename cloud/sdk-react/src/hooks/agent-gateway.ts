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
  agentAuthHarnessSettingsKey,
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

/**
 * The mint flow's vault upload (seats v1, `uploadSeatToken`'s POST): one
 * `POST /keys` with `kind: "anthropic_subscription"` carrying the captured
 * token — held in memory only, never retried silently (react-query mutations
 * do not retry by default; a failure surfaces to the mint flow, which tells
 * the user to re-run the mint). Unlike the bare-key create, a seat mint
 * changes the rendered auth state (the pool grows), so the state and
 * selections roots invalidate too — that re-pull is what hands the new seat
 * to the courier's delivery loop.
 */
export function useMintAgentSeat() {
  const client = useCloudClient();
  const queryClient = useQueryClient();
  return useMutation<AgentApiKey, Error, CreateAgentApiKeyRequest>({
    mutationFn: (input) =>
      createAgentApiKey({ ...input, kind: "anthropic_subscription" }, client),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: agentApiKeysKey() });
      void queryClient.invalidateQueries({ queryKey: agentAuthSelectionsRootKey() });
      void queryClient.invalidateQueries({ queryKey: agentAuthStateRootKey() });
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

export interface AuthQueryPollOptions {
  /**
   * Re-fetch on an interval (ms). The delivery-ack pipeline uses this to
   * observe pending→applied flips that land server-side (the cloud
   * materializer's ack) without a client mutation to invalidate on.
   */
  refetchInterval?: number | false;
}

export function useAuthSelections(
  surface: AgentAuthSurface | null = null,
  enabled = true,
  options: AuthQueryPollOptions = {},
) {
  const client = useCloudClient();
  return useQuery<AgentAuthSelection[]>({
    queryKey: agentAuthSelectionsKey(surface),
    queryFn: () => listAuthSelections(surface ?? undefined, client),
    enabled,
    refetchInterval: options.refetchInterval ?? false,
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

/** The `harness_settings` rider off `GET /state`: `{harnessKind: {key: bool}}`. */
export type AgentAuthHarnessSettingsMap = NonNullable<
  AgentAuthState["harness_settings"]
>;

/**
 * The settings pane's toggle read (agent_auth spec §2, the `harness_settings`
 * rider on `GET /state` — the spec-sanctioned pane read for per-harness
 * toggles like `rotate`). SELECTS ONLY THE RIDER: the queryFn extracts
 * `harness_settings` and drops the rest of the response, so the cache never
 * holds the state.json document body — it carries the caller's decrypted
 * credential material (see `useAgentAuthState`).
 */
export function useAgentAuthHarnessSettings(
  surface: AgentAuthSurface,
  enabled = true,
) {
  const client = useCloudClient();
  return useQuery<AgentAuthHarnessSettingsMap>({
    queryKey: agentAuthHarnessSettingsKey(surface),
    queryFn: async () => {
      const state = await getAgentAuthState(surface, client);
      return state.harness_settings ?? {};
    },
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
// The composed re-key (model-catalog.md §Cloud routes): the layered read is
// scoped by harness alone — one composed observation per harness; the former
// `authContextId` scope member is deleted. `useRefreshAgentCatalog` and
// `useMirrorAgentCatalog` are DELETED, not renamed — the single ingest route
// (`POST /agent-models/{h}/refresh`) is Worker-authenticated
// (`authenticate_worker`), so no product client can call it; keeping a hook
// that can only 403 would be a live export aimed at a dead call (F-040). A
// manual "refresh" affordance for the settings All Models pane returns in C3
// once a real caller exists.

export function useAgentModels(harnessKind: string, enabled = true) {
  const client = useCloudClient();
  return useQuery<AgentModels>({
    queryKey: agentModelsKey(harnessKind),
    queryFn: () => getAgentModels(harnessKind, client),
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
      // Overrides are per-harness and layer over every read of that harness.
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

export function useAgentGatewayEnrollment(
  enabled = true,
  options: AuthQueryPollOptions = {},
) {
  const client = useCloudClient();
  return useQuery<AgentGatewayEnrollment>({
    queryKey: agentGatewayEnrollmentKey(),
    queryFn: () => getAgentGatewayEnrollment(client),
    enabled,
    refetchInterval: options.refetchInterval ?? false,
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
