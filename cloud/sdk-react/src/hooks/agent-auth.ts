import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createAgentAuthCredentialShare,
  createGatewayCredential,
  deleteAgentAuthCredential,
  deleteAgentAuthCredentialShare,
  ensureManagedCreditsForOrganization,
  ensureOrganizationSandboxProfile,
  ensurePersonalSandboxProfile,
  getSandboxAgentAuthSelections,
  getSandboxAgentAuthTargetStates,
  listAgentAuthCredentials,
  putSandboxAgentAuthSelection,
  type AgentAuthAgentKind,
  type AgentAuthCredential,
  type AgentAuthCredentialListOptions,
  type CreateGatewayCredentialRequest,
  type EnsureManagedCreditsRequest,
  type SandboxAgentAuthSelection,
  type SandboxAgentAuthTargetState,
  type SandboxProfile,
  type SelectAgentAuthCredentialInput,
} from "@proliferate/cloud-sdk";
import { useCloudClient } from "../context/CloudClientProvider.js";
import {
  agentAuthCredentialsKey,
  agentAuthRootKey,
  sandboxAgentAuthSelectionsKey,
  sandboxAgentAuthTargetStatesKey,
} from "../lib/query-keys.js";

const EMPTY_CREDENTIALS: AgentAuthCredential[] = [];
const EMPTY_SELECTIONS: SandboxAgentAuthSelection[] = [];
const EMPTY_TARGET_STATES: SandboxAgentAuthTargetState[] = [];

export function useAgentAuthCredentials(
  options: AgentAuthCredentialListOptions & { enabled?: boolean } = {},
) {
  const client = useCloudClient();
  const organizationId = options.organizationId ?? null;
  const agentKind = options.agentKind ?? null;
  return useQuery<AgentAuthCredential[]>({
    queryKey: agentAuthCredentialsKey(organizationId, agentKind),
    queryFn: () => listAgentAuthCredentials({ organizationId, agentKind }, client),
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
    mutationFn: (input: { managedTargetId?: string | null } = {}) =>
      ensurePersonalSandboxProfile(input, client),
    onSuccess: invalidateAgentAuth,
  });

  const ensureOrganizationProfile = useMutation({
    mutationFn: (input: { organizationId: string; managedTargetId?: string | null }) =>
      ensureOrganizationSandboxProfile(
        input.organizationId,
        { managedTargetId: input.managedTargetId ?? null },
        client,
      ),
    onSuccess: invalidateAgentAuth,
  });

  const selectCredential = useMutation({
    mutationFn: (input: {
      sandboxProfileId: string;
      agentKind: AgentAuthAgentKind;
      selection: SelectAgentAuthCredentialInput;
    }) => putSandboxAgentAuthSelection(
      input.sandboxProfileId,
      input.agentKind,
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

  return {
    createCredential: createCredential.mutateAsync,
    isCreatingCredential: createCredential.isPending,
    deleteCredential: deleteCredential.mutateAsync,
    isDeletingCredential: deleteCredential.isPending,
    createShare: createShare.mutateAsync,
    isCreatingShare: createShare.isPending,
    deleteShare: deleteShare.mutateAsync,
    isDeletingShare: deleteShare.isPending,
    ensurePersonalProfile: ensurePersonalProfile.mutateAsync as (
      input?: { managedTargetId?: string | null },
    ) => Promise<SandboxProfile>,
    ensureOrganizationProfile: ensureOrganizationProfile.mutateAsync,
    isEnsuringProfile: ensurePersonalProfile.isPending || ensureOrganizationProfile.isPending,
    selectCredential: selectCredential.mutateAsync,
    isSelectingCredential: selectCredential.isPending,
    ensureManagedCredits: ensureManagedCredits.mutateAsync,
    isEnsuringManagedCredits: ensureManagedCredits.isPending,
  };
}
