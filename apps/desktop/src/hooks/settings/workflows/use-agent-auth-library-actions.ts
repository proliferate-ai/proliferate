import { useEffect, useMemo, useState } from "react";
import type {
  AgentAuthAgentKind,
  AgentAuthCredential,
  AgentAuthCredentialProviderId,
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
} from "@/hooks/access/tauri/use-credentials-actions";
import { useAuthStore } from "@/stores/auth/auth-store";
import { groupAgentAuthCredentialsByProvider } from "@/lib/domain/agent-auth/credential-collections";
import {
  agentAuthPrimarySlotForAgent,
  agentAuthSlotDomId,
} from "@/lib/domain/agent-auth/auth-slots";
import { useAgentAuthLocalSources } from "./agent-auth-library/use-agent-auth-local-sources";
import { useAgentAuthLibraryOrganizationSelection } from "./agent-auth-library/use-agent-auth-library-organization-selection";
import { useAgentAuthLibraryProfiles } from "./agent-auth-library/use-agent-auth-library-profiles";

export function useAgentAuthLibraryActions(
  initialAgentKind: AgentAuthAgentKind | null,
  initialOrganizationId: string | null = null,
  options: { autoLoadPersonalProfile?: boolean } = {},
) {
  const autoLoadPersonalProfile = options.autoLoadPersonalProfile ?? true;
  const {
    organizationOptions,
    selectedOrganizationId,
    selectedOrganization,
    setSelectedOrganizationId,
    isAdminForSelectedOrganization,
  } = useAgentAuthLibraryOrganizationSelection(initialOrganizationId);
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
  const {
    localSourceError,
    localSourcesByProvider,
    rescanning,
    handleRescan,
  } = useAgentAuthLocalSources({
    listSyncableAgentAuthCredentials,
    setFeedback,
  });
  const [sharingCredentialId, setSharingCredentialId] = useState<string | null>(null);
  const [revokingShareId, setRevokingShareId] = useState<string | null>(null);
  const [revokingCredentialId, setRevokingCredentialId] = useState<string | null>(null);
  const [syncingLocalProvider, setSyncingLocalProvider] = useState<AgentAuthProvider | null>(
    null,
  );
  const {
    organizationProfile,
    setOrganizationProfile,
    personalProfile,
    setPersonalProfile,
    organizationProfileLoading,
    personalProfileLoading,
  } = useAgentAuthLibraryProfiles({
    autoLoadPersonalProfile,
    initialOrganizationId,
    selectedOrganizationId,
    ensureOrganizationProfile: mutations.ensureOrganizationProfile,
    ensurePersonalProfile: mutations.ensurePersonalProfile,
    setFeedback,
  });
  const [focusedAgentKind, setFocusedAgentKind] = useState<AgentAuthAgentKind | null>(
    initialAgentKind,
  );
  const selections = useSandboxAgentAuthSelections(organizationProfile?.id ?? null);
  const personalSelections = useSandboxAgentAuthSelections(personalProfile?.id ?? null);
  const personalCredentialsByProvider = useMemo(
    () => groupAgentAuthCredentialsByProvider(personalCredentials.data ?? []),
    [personalCredentials.data],
  );

  useEffect(() => {
    if (!initialAgentKind) {
      return;
    }
    setFocusedAgentKind(initialAgentKind);
    window.requestAnimationFrame(() => {
      const primarySlot = agentAuthPrimarySlotForAgent(initialAgentKind, agentGatewayCapabilities);
      if (!primarySlot) {
        return;
      }
      document
        .getElementById(agentAuthSlotDomId(primarySlot.agentKind, primarySlot.authSlotId))
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }, [agentGatewayCapabilities, initialAgentKind]);

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
      setFeedback("Shared sandbox auth refreshed.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Could not load shared sandbox auth.");
    }
  }

  async function ensureOrganizationProfileLoaded() {
    if (organizationProfile) {
      return organizationProfile;
    }
    if (!selectedOrganizationId) {
      throw new Error("Select a team before choosing shared sandbox auth.");
    }
    const nextProfile = await mutations.ensureOrganizationProfile({
      organizationId: selectedOrganizationId,
    });
    setOrganizationProfile(nextProfile);
    return nextProfile;
  }

  async function ensurePersonalProfileLoaded() {
    if (personalProfile) {
      return personalProfile;
    }
    const nextProfile = await mutations.ensurePersonalProfile();
    setPersonalProfile(nextProfile);
    return nextProfile;
  }

  async function handleEnsurePersonalProfile() {
    setFeedback(null);
    try {
      await ensurePersonalProfileLoaded();
      setFeedback("Personal cloud auth profile loaded.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Could not load personal cloud defaults.");
    }
  }

  async function handleSelectPersonalDefault(
    agentKind: AgentAuthAgentKind,
    authSlotId: AgentAuthCredentialProviderId | string,
    credentialId: string,
  ) {
    if (!credentialId) {
      return;
    }
    setFeedback(null);
    try {
      const profile = await ensurePersonalProfileLoaded();
      await mutations.selectCredential({
        sandboxProfileId: profile.id,
        agentKind,
        authSlotId,
        selection: {
          credentialId,
          credentialShareId: null,
        },
      });
      setFeedback("Personal cloud default saved.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Could not save personal cloud default.");
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

  async function handleEnsureFreeCredits() {
    setFeedback(null);
    try {
      await ensurePersonalProfileLoaded();
      const result = await mutations.ensureFreeCredits({});
      if (result.launchEnabled) {
        setFeedback("Proliferate default free credits are ready.");
        return;
      }
      setFeedback(result.lastErrorMessage ?? "Proliferate default free credits are not ready yet.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Could not provision free credits.");
    }
  }

  async function handleSelectTeamDefault(
    agentKind: AgentAuthAgentKind,
    authSlotId: AgentAuthCredentialProviderId | string,
    credentialId: string,
  ) {
    if (!credentialId) {
      return;
    }
    setFeedback(null);
    try {
      const profile = await ensureOrganizationProfileLoaded();
      const selectedCredential = (organizationCredentials.data ?? []).find(
        (credential) => credential.id === credentialId,
      );
      await mutations.selectCredential({
        sandboxProfileId: profile.id,
        agentKind,
        authSlotId,
        selection: {
          credentialId,
          credentialShareId: selectedCredential?.activeCredentialShareId ?? null,
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
    personalCredentialsByProvider,
    organizationCredentials: organizationCredentials.data ?? [],
    organizationCredentialsLoading: organizationCredentials.isLoading,
    organizationSelectionsLoading: organizationProfileLoading
      || (organizationProfile !== null && (selections.isLoading || selections.isFetching)),
    personalCredentialsLoading: personalCredentials.isLoading,
    personalSelectionsLoading: personalProfileLoading
      || (personalProfile !== null && (personalSelections.isLoading || personalSelections.isFetching)),
    organizationCredentialsError: organizationCredentials.error,
    personalCredentialsError: personalCredentials.error,
    capabilities: agentGatewayCapabilities,
    personalProfile,
    personalSelections: personalSelections.data ?? [],
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
    ensuringFreeCredits: mutations.isEnsuringFreeCredits,
    selectingTeamDefault: mutations.isSelectingCredential,
    handleRescan,
    handleSyncLocalCredential,
    handleShareCredential,
    handleRevokeShare,
    handleRevokeCredential,
    handleEnsureOrganizationProfile,
    handleEnsurePersonalProfile,
    handleEnsureManagedCredits,
    handleEnsureFreeCredits,
    handleSelectPersonalDefault,
    handleSelectTeamDefault,
  };
}
