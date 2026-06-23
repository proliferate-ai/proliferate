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
import { useAgentAuthLibraryProfiles } from "./agent-auth-library/use-agent-auth-library-profiles";

export function useAgentAuthLibraryActions(
  initialAgentKind: AgentAuthAgentKind | null,
  options: { autoLoadPersonalProfile?: boolean } = {},
) {
  const autoLoadPersonalProfile = options.autoLoadPersonalProfile ?? true;
  const personalCredentials = useAgentAuthCredentials({ organizationId: null });
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
  const [revokingCredentialId, setRevokingCredentialId] = useState<string | null>(null);
  const [syncingLocalProvider, setSyncingLocalProvider] = useState<AgentAuthProvider | null>(
    null,
  );
  const {
    personalProfile,
    setPersonalProfile,
    personalProfileLoading,
  } = useAgentAuthLibraryProfiles({
    autoLoadPersonalProfile,
    ensurePersonalProfile: mutations.ensurePersonalProfile,
    setFeedback,
  });
  const [focusedAgentKind, setFocusedAgentKind] = useState<AgentAuthAgentKind | null>(
    initialAgentKind,
  );
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

  return {
    currentUserId,
    feedback,
    localSourceError,
    localSourcesByProvider,
    personalCredentialsByProvider,
    personalCredentialsLoading: personalCredentials.isLoading,
    personalSelectionsLoading: personalProfileLoading
      || (personalProfile !== null && (personalSelections.isLoading || personalSelections.isFetching)),
    personalCredentialsError: personalCredentials.error,
    capabilities: agentGatewayCapabilities,
    personalProfile,
    personalSelections: personalSelections.data ?? [],
    focusedAgentKind,
    syncingLocalProvider,
    rescanning,
    revokingCredentialId,
    ensuringProfile: mutations.isEnsuringProfile,
    ensuringFreeCredits: mutations.isEnsuringFreeCredits,
    selectingPersonalDefault: mutations.isSelectingCredential,
    handleRescan,
    handleSyncLocalCredential,
    handleRevokeCredential,
    handleEnsurePersonalProfile,
    handleEnsureFreeCredits,
    handleSelectPersonalDefault,
  };
}
