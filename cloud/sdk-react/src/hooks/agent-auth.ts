import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createAgentAuthCredentialShare,
  createGatewayCredential,
  deleteAgentAuthCredential,
  deleteAgentAuthCredentialShare,
  enableSandboxProfileCloud,
  ensureFreeManagedCredits,
  ensureManagedCreditsForOrganization,
  ensureOrganizationSandboxProfile,
  ensurePersonalSandboxProfile,
  getCloudCapabilities,
  getSandboxAgentAuthSelections,
  getSandboxAgentAuthTargetStates,
  getSandboxProfileTargetState,
  listAgentAuthCredentials,
  putSandboxAgentAuthSelection,
  syncSyncedAgentAuthCredential,
  type AgentAuthAgentKind,
  type AgentAuthCredential,
  type AgentAuthCredentialProviderId,
  type AgentAuthCredentialListOptions,
  type CloudCapabilities,
  type CreateGatewayCredentialRequest,
  type EnsureFreeManagedCreditsRequest,
  type EnsureManagedCreditsRequest,
  type SandboxAgentAuthSelection,
  type SandboxAgentAuthTargetState,
  type SandboxProfile,
  type SandboxProfileTargetState,
  type SelectAgentAuthCredentialInput,
  type SyncSyncedCredentialRequest,
} from "@proliferate/cloud-sdk";
import { useCloudClient } from "../context/CloudClientProvider.js";
import {
  agentAuthCredentialsKey,
  agentAuthRootKey,
  cloudCapabilitiesKey,
  cloudTargetsKey,
  sandboxAgentAuthSelectionsKey,
  sandboxAgentAuthTargetStatesKey,
  sandboxProfileTargetStateKey,
} from "../lib/query-keys.js";

const EMPTY_CREDENTIALS: AgentAuthCredential[] = [];
const EMPTY_SELECTIONS: SandboxAgentAuthSelection[] = [];
const EMPTY_TARGET_STATES: SandboxAgentAuthTargetState[] = [];

export function useCloudCapabilities(enabled = true) {
  const client = useCloudClient();
  return useQuery<CloudCapabilities>({
    queryKey: cloudCapabilitiesKey(),
    queryFn: () => getCloudCapabilities(client),
    enabled,
  });
}

export function useAgentAuthCredentials(
  options: AgentAuthCredentialListOptions & { enabled?: boolean } = {},
) {
  const client = useCloudClient();
  const organizationId = options.organizationId ?? null;
  const credentialProviderId = options.credentialProviderId ?? null;
  const agentKind = options.agentKind ?? null;
  return useQuery<AgentAuthCredential[]>({
    queryKey: agentAuthCredentialsKey(organizationId, credentialProviderId, agentKind),
    queryFn: () =>
      listAgentAuthCredentials({ organizationId, credentialProviderId, agentKind }, client),
    enabled: options.enabled ?? true,
    placeholderData: EMPTY_CREDENTIALS,
  });
}

export function useSandboxAgentAuthSelections(
  sandboxProfileId: string | null,
  enabled = true,
) {
  const client = useCloudClient();
  return useQuery<SandboxAgentAuthSelection[]>({
    queryKey: sandboxAgentAuthSelectionsKey(sandboxProfileId),
    queryFn: () => getSandboxAgentAuthSelections(sandboxProfileId!, client),
    enabled: enabled && sandboxProfileId !== null,
    placeholderData: EMPTY_SELECTIONS,
  });
}

export function useSandboxAgentAuthTargetStates(
  sandboxProfileId: string | null,
  enabled = true,
) {
  const client = useCloudClient();
  return useQuery<SandboxAgentAuthTargetState[]>({
    queryKey: sandboxAgentAuthTargetStatesKey(sandboxProfileId),
    queryFn: () => getSandboxAgentAuthTargetStates(sandboxProfileId!, client),
    enabled: enabled && sandboxProfileId !== null,
    placeholderData: EMPTY_TARGET_STATES,
  });
}

export function useSandboxProfileTargetState(
  sandboxProfileId: string | null,
  enabled = true,
) {
  const client = useCloudClient();
  return useQuery<SandboxProfileTargetState>({
    queryKey: sandboxProfileTargetStateKey(sandboxProfileId),
    queryFn: () => getSandboxProfileTargetState(sandboxProfileId!, client),
    enabled: enabled && sandboxProfileId !== null,
  });
}

export function useAgentAuthMutations() {
  const client = useCloudClient();
  const queryClient = useQueryClient();

  const invalidateAgentAuth = async () => {
    await queryClient.invalidateQueries({ queryKey: agentAuthRootKey() });
  };

  const createCredential = useMutation({
    mutationFn: (body: CreateGatewayCredentialRequest) =>
      createGatewayCredential(body, client),
    onSuccess: invalidateAgentAuth,
  });

  const syncSyncedCredential = useMutation({
    mutationFn: (input: {
      agentKind: Extract<AgentAuthAgentKind, "claude" | "codex" | "gemini">;
      body: SyncSyncedCredentialRequest;
    }) => syncSyncedAgentAuthCredential(input.agentKind, input.body, client),
    onSuccess: invalidateAgentAuth,
  });

  const deleteCredential = useMutation({
    mutationFn: (credentialId: string) => deleteAgentAuthCredential(credentialId, client),
    onSuccess: invalidateAgentAuth,
  });

  const createShare = useMutation({
    mutationFn: (input: { credentialId: string; organizationId: string }) =>
      createAgentAuthCredentialShare(
        input.credentialId,
        input.organizationId,
        client,
      ),
    onSuccess: invalidateAgentAuth,
  });

  const deleteShare = useMutation({
    mutationFn: (shareId: string) => deleteAgentAuthCredentialShare(shareId, client),
    onSuccess: invalidateAgentAuth,
  });

  const ensurePersonalProfile = useMutation({
    mutationFn: () => ensurePersonalSandboxProfile(client),
    onSuccess: invalidateAgentAuth,
  });

  const ensureOrganizationProfile = useMutation({
    mutationFn: (input: { organizationId: string }) =>
      ensureOrganizationSandboxProfile(input.organizationId, client),
    onSuccess: invalidateAgentAuth,
  });

  const enableProfileCloud = useMutation({
    mutationFn: (input: { sandboxProfileId: string }) =>
      enableSandboxProfileCloud(input.sandboxProfileId, client),
    onSuccess: async (_state, input) => {
      await invalidateAgentAuth();
      await queryClient.invalidateQueries({ queryKey: cloudTargetsKey() });
      await queryClient.invalidateQueries({
        queryKey: sandboxProfileTargetStateKey(input.sandboxProfileId),
      });
    },
  });

  const selectCredential = useMutation({
    mutationFn: (input: {
      sandboxProfileId: string;
      agentKind: AgentAuthAgentKind;
      authSlotId: AgentAuthCredentialProviderId | string;
      selection: SelectAgentAuthCredentialInput;
    }) => putSandboxAgentAuthSelection(
      input.sandboxProfileId,
      input.agentKind,
      input.authSlotId,
      input.selection,
      client,
    ),
    onSuccess: invalidateAgentAuth,
  });

  const ensureManagedCredits = useMutation({
    mutationFn: (input: {
      organizationId: string;
      request?: EnsureManagedCreditsRequest;
    }) => ensureManagedCreditsForOrganization(
      input.organizationId,
      input.request ?? {},
      client,
    ),
    onSuccess: invalidateAgentAuth,
  });

  const ensureFreeCredits = useMutation({
    mutationFn: (request?: EnsureFreeManagedCreditsRequest) =>
      ensureFreeManagedCredits(request ?? {}, client),
    onSuccess: invalidateAgentAuth,
  });

  return {
    createCredential: createCredential.mutateAsync,
    isCreatingCredential: createCredential.isPending,
    syncSyncedCredential: syncSyncedCredential.mutateAsync,
    isSyncingSyncedCredential: syncSyncedCredential.isPending,
    deleteCredential: deleteCredential.mutateAsync,
    isDeletingCredential: deleteCredential.isPending,
    createShare: createShare.mutateAsync,
    isCreatingShare: createShare.isPending,
    deleteShare: deleteShare.mutateAsync,
    isDeletingShare: deleteShare.isPending,
    ensurePersonalProfile: ensurePersonalProfile.mutateAsync as () => Promise<SandboxProfile>,
    ensureOrganizationProfile: ensureOrganizationProfile.mutateAsync,
    enableProfileCloud: enableProfileCloud.mutateAsync,
    isEnsuringProfile: ensurePersonalProfile.isPending || ensureOrganizationProfile.isPending,
    isEnablingProfileCloud: enableProfileCloud.isPending,
    selectCredential: selectCredential.mutateAsync,
    isSelectingCredential: selectCredential.isPending,
    ensureManagedCredits: ensureManagedCredits.mutateAsync,
    isEnsuringManagedCredits: ensureManagedCredits.isPending,
    ensureFreeCredits: ensureFreeCredits.mutateAsync,
    isEnsuringFreeCredits: ensureFreeCredits.isPending,
  };
}
