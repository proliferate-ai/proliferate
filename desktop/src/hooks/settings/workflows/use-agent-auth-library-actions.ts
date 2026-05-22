import { useEffect, useMemo, useState } from "react";
import type {
  AgentAuthAgentKind,
  AgentAuthCredential,
  SandboxProfile,
} from "@proliferate/cloud-sdk";
import {
  useAgentAuthCredentials,
  useAgentAuthMutations,
  useCloudCapabilities,
  useSandboxAgentAuthSelections,
} from "@proliferate/cloud-sdk-react/hooks/agent-auth";
import {
  useTauriCredentialsActions,
  type AgentAuthProvider,
  type LocalAgentAuthSource,
} from "@/hooks/access/tauri/use-credentials-actions";
import { useOrganizations } from "@/hooks/access/cloud/organizations/use-organizations";
import { useAuthStore } from "@/stores/auth/auth-store";
import { isAgentAuthAdminRole } from "@/lib/domain/agent-auth/agent-auth-presentation";

export type AgentAuthLibraryOrganizationOption =
  NonNullable<ReturnType<typeof useOrganizations>["data"]>["organizations"][number];

export function useAgentAuthLibraryActions(initialAgentKind: AgentAuthAgentKind | null) {
  const organizations = useOrganizations();
  const organizationOptions = organizations.data?.organizations ?? [];
  const organizationIdsKey = organizationOptions.map((organization) => organization.id).join(":");
  const [selectedOrganizationId, setSelectedOrganizationId] = useState<string | null>(null);
  const personalCredentials = useAgentAuthCredentials({ organizationId: null });
  const organizationCredentials = useAgentAuthCredentials({
    organizationId: selectedOrganizationId,
    enabled: selectedOrganizationId !== null,
  });
  const { data: capabilities } = useCloudCapabilities();
  const agentGatewayCapabilities = capabilities?.agentGateway ?? null;
  const mutations = useAgentAuthMutations();
  const {
    exportSyncableAgentAuthCredential,
    listSyncableAgentAuthCredentials,
  } = useTauriCredentialsActions();
  const currentUserId = useAuthStore((state) => state.user?.id ?? null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [localSourceError, setLocalSourceError] = useState<string | null>(null);
  const [sharingCredentialId, setSharingCredentialId] = useState<string | null>(null);
  const [revokingShareId, setRevokingShareId] = useState<string | null>(null);
  const [revokingCredentialId, setRevokingCredentialId] = useState<string | null>(null);
  const [localSources, setLocalSources] = useState<LocalAgentAuthSource[]>([]);
  const [syncingLocalProvider, setSyncingLocalProvider] = useState<AgentAuthProvider | null>(
    null,
  );
  const [rescanning, setRescanning] = useState(false);
  const [organizationProfile, setOrganizationProfile] = useState<SandboxProfile | null>(null);
  const [focusedAgentKind, setFocusedAgentKind] = useState<AgentAuthAgentKind | null>(
    initialAgentKind,
  );
  const selectedOrganization = organizationOptions.find(
    (organization) => organization.id === selectedOrganizationId,
  ) ?? null;
  const adminOrganizationIds = useMemo(
    () => new Set(
      organizationOptions
        .filter(isAdminOrganization)
        .map((organization) => organization.id),
    ),
    [organizationOptions],
  );
  const isAdminForSelectedOrganization = Boolean(
    selectedOrganizationId && adminOrganizationIds.has(selectedOrganizationId),
  );
  const selections = useSandboxAgentAuthSelections(organizationProfile?.id ?? null);
  const localSourcesByProvider = useMemo(
    () => new Map(localSources.map((source) => [source.provider, source])),
    [localSources],
  );
  const personalCredentialsForSelectedTeam = useMemo(() => {
    if (!selectedOrganizationId || !currentUserId) {
      return personalCredentials.data ?? [];
    }
    return (organizationCredentials.data ?? []).filter((credential) =>
      credential.ownerScope === "personal" && credential.ownerUserId === currentUserId);
  }, [currentUserId, organizationCredentials.data, personalCredentials.data, selectedOrganizationId]);
  const personalCredentialsByAgent = useMemo(
    () => groupCredentialsByAgent(personalCredentialsForSelectedTeam),
    [personalCredentialsForSelectedTeam],
  );

  useEffect(() => {
    if (organizationOptions.length === 0) {
      if (selectedOrganizationId !== null) {
        setSelectedOrganizationId(null);
      }
      return;
    }
    if (
      selectedOrganizationId === null
      || !organizationOptions.some((organization) => organization.id === selectedOrganizationId)
    ) {
      setSelectedOrganizationId(organizationOptions[0].id);
    }
  }, [organizationIdsKey, organizationOptions, selectedOrganizationId]);

  useEffect(() => {
    setOrganizationProfile(null);
  }, [selectedOrganizationId]);

  useEffect(() => {
    if (!initialAgentKind) {
      return;
    }
    setFocusedAgentKind(initialAgentKind);
    window.requestAnimationFrame(() => {
      document
        .getElementById(`agent-auth-${initialAgentKind}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }, [initialAgentKind]);

  useEffect(() => {
    let cancelled = false;
    void loadLocalSources(listSyncableAgentAuthCredentials, setRescanning)
      .then((sources) => {
        if (!cancelled) {
          setLocalSources(sources);
          setLocalSourceError(null);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setLocalSources([]);
          setLocalSourceError(
            error instanceof Error ? error.message : "Could not scan local credentials.",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [listSyncableAgentAuthCredentials]);

  async function handleRescan() {
    setFeedback(null);
    setLocalSourceError(null);
    try {
      const sources = await loadLocalSources(listSyncableAgentAuthCredentials, setRescanning);
      setLocalSources(sources);
      setFeedback("Local credentials scanned.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not scan local credentials.";
      setLocalSourceError(message);
      setFeedback(message);
    }
  }

  async function handleSyncLocalCredential(provider: AgentAuthProvider) {
    setSyncingLocalProvider(provider);
    setFeedback(null);
    try {
      const body = await exportSyncableAgentAuthCredential(provider);
      const result = await mutations.syncSyncedCredential({ agentKind: provider, body });
      setFeedback(`${result.credential.displayName} synced.`);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Could not sync local auth.");
    } finally {
      setSyncingLocalProvider(null);
    }
  }

  async function handleShareCredential(credential: AgentAuthCredential) {
    if (!selectedOrganizationId) {
      setFeedback("Select a team before allowing team use.");
      return;
    }
    setSharingCredentialId(credential.id);
    setFeedback(null);
    try {
      await mutations.createShare({
        credentialId: credential.id,
        organizationId: selectedOrganizationId,
      });
      setFeedback(`${credential.displayName} can now be used by ${selectedOrganization?.name ?? "the team"}.`);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Could not allow team use.");
    } finally {
      setSharingCredentialId(null);
    }
  }

  async function handleRevokeShare(credential: AgentAuthCredential) {
    if (!credential.activeCredentialShareId) {
      return;
    }
    setRevokingShareId(credential.activeCredentialShareId);
    setFeedback(null);
    try {
      await mutations.deleteShare(credential.activeCredentialShareId);
      setFeedback(`${credential.displayName} team use revoked.`);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Could not revoke team use.");
    } finally {
      setRevokingShareId(null);
    }
  }

  async function handleRevokeCredential(credential: AgentAuthCredential) {
    setRevokingCredentialId(credential.id);
    setFeedback(null);
    try {
      await mutations.deleteCredential(credential.id);
      setFeedback(`${credential.displayName} revoked.`);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Could not revoke credential.");
    } finally {
      setRevokingCredentialId(null);
    }
  }

  async function handleEnsureOrganizationProfile() {
    if (!selectedOrganizationId) {
      return;
    }
    setFeedback(null);
    try {
      const nextProfile = await mutations.ensureOrganizationProfile({
        organizationId: selectedOrganizationId,
      });
      setOrganizationProfile(nextProfile);
      setFeedback("Team defaults loaded.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Could not load team defaults.");
    }
  }

  async function handleEnsureManagedCredits() {
    if (!selectedOrganizationId) {
      return;
    }
    setFeedback(null);
    try {
      await mutations.ensureManagedCredits({
        organizationId: selectedOrganizationId,
      });
      setFeedback("Managed credits are ready for the team.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Could not provision managed credits.");
    }
  }

  async function handleSelectTeamDefault(
    agentKind: AgentAuthAgentKind,
    credentialId: string,
  ) {
    if (!organizationProfile || !credentialId) {
      return;
    }
    setFeedback(null);
    try {
      await mutations.selectCredential({
        sandboxProfileId: organizationProfile.id,
        agentKind,
        selection: {
          credentialId,
          credentialShareId: (organizationCredentials.data ?? []).find(
            (credential) => credential.id === credentialId && credential.agentKind === agentKind,
          )?.activeCredentialShareId ?? null,
        },
      });
      setFeedback("Team default saved.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Could not save team default.");
    }
  }

  return {
    organizationOptions,
    selectedOrganizationId,
    selectedOrganization,
    setSelectedOrganizationId,
    currentUserId,
    feedback,
    localSourceError,
    localSourcesByProvider,
    personalCredentialsByAgent,
    organizationCredentials: organizationCredentials.data ?? [],
    organizationCredentialsLoading: organizationCredentials.isLoading,
    personalCredentialsLoading: personalCredentials.isLoading,
    organizationCredentialsError: organizationCredentials.error,
    personalCredentialsError: personalCredentials.error,
    capabilities: agentGatewayCapabilities,
    organizationProfile,
    selections: selections.data ?? [],
    isAdminForSelectedOrganization,
    focusedAgentKind,
    syncingLocalProvider,
    rescanning,
    sharingCredentialId,
    revokingShareId,
    revokingCredentialId,
    ensuringProfile: mutations.isEnsuringProfile,
    ensuringManagedCredits: mutations.isEnsuringManagedCredits,
    selectingTeamDefault: mutations.isSelectingCredential,
    handleRescan,
    handleSyncLocalCredential,
    handleShareCredential,
    handleRevokeShare,
    handleRevokeCredential,
    handleEnsureOrganizationProfile,
    handleEnsureManagedCredits,
    handleSelectTeamDefault,
  };
}

function groupCredentialsByAgent(credentials: AgentAuthCredential[]) {
  const grouped = new Map<string, AgentAuthCredential[]>();
  for (const credential of credentials) {
    const entries = grouped.get(credential.agentKind) ?? [];
    entries.push(credential);
    grouped.set(credential.agentKind, entries);
  }
  return grouped;
}

function isAdminOrganization(organization: AgentAuthLibraryOrganizationOption): boolean {
  return isAgentAuthAdminRole(organization.membership?.role);
}

async function loadLocalSources(
  listSyncableAgentAuthCredentials: () => Promise<LocalAgentAuthSource[]>,
  setRescanning: (rescanning: boolean) => void,
) {
  setRescanning(true);
  try {
    return await listSyncableAgentAuthCredentials();
  } finally {
    setRescanning(false);
  }
}
