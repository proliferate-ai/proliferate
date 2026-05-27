import { useEffect, useMemo, useRef, useState } from "react";
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

export function useAgentAuthLibraryActions(
  initialAgentKind: AgentAuthAgentKind | null,
  initialOrganizationId: string | null = null,
  options: { autoLoadPersonalProfile?: boolean } = {},
) {
  const autoLoadPersonalProfile = options.autoLoadPersonalProfile ?? true;
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
  const [personalProfile, setPersonalProfile] = useState<SandboxProfile | null>(null);
  const [organizationProfileLoading, setOrganizationProfileLoading] = useState(false);
  const [personalProfileLoading, setPersonalProfileLoading] = useState(false);
  const autoLoadedOrganizationProfileIdRef = useRef<string | null>(null);
  const autoLoadedPersonalProfileRef = useRef(false);
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
  const personalSelections = useSandboxAgentAuthSelections(personalProfile?.id ?? null);
  const localSourcesByProvider = useMemo(
    () => new Map(localSources.map((source) => [source.provider, source])),
    [localSources],
  );
  const personalCredentialsByAgent = useMemo(
    () => groupCredentialsByAgent(personalCredentials.data ?? []),
    [personalCredentials.data],
  );

  useEffect(() => {
    if (organizationOptions.length === 0) {
      if (selectedOrganizationId !== null) {
        setSelectedOrganizationId(null);
      }
      return;
    }
    const nextSelectedId =
      initialOrganizationId
      && organizationOptions.some((organization) => organization.id === initialOrganizationId)
        ? initialOrganizationId
        : organizationOptions[0].id;
    if (
      selectedOrganizationId === null
      || !organizationOptions.some((organization) => organization.id === selectedOrganizationId)
      || (initialOrganizationId !== null && selectedOrganizationId !== nextSelectedId)
    ) {
      setSelectedOrganizationId(nextSelectedId);
    }
  }, [initialOrganizationId, organizationIdsKey, organizationOptions, selectedOrganizationId]);

  useEffect(() => {
    setOrganizationProfile(null);
    setOrganizationProfileLoading(false);
    autoLoadedOrganizationProfileIdRef.current = null;
  }, [selectedOrganizationId]);

  useEffect(() => {
    if (
      initialOrganizationId === null
      || selectedOrganizationId === null
      || organizationProfile !== null
      || autoLoadedOrganizationProfileIdRef.current === selectedOrganizationId
    ) {
      return;
    }

    let cancelled = false;
    autoLoadedOrganizationProfileIdRef.current = selectedOrganizationId;
    setOrganizationProfileLoading(true);
    void mutations.ensureOrganizationProfile({ organizationId: selectedOrganizationId })
      .then((nextProfile) => {
        if (!cancelled) {
          setOrganizationProfile(nextProfile);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          autoLoadedOrganizationProfileIdRef.current = null;
          setFeedback(error instanceof Error ? error.message : "Could not load shared sandbox auth.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setOrganizationProfileLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [initialOrganizationId, organizationProfile, selectedOrganizationId]);

  useEffect(() => {
    if (
      !autoLoadPersonalProfile
      || personalProfile !== null
      || autoLoadedPersonalProfileRef.current
    ) {
      return;
    }

    let cancelled = false;
    autoLoadedPersonalProfileRef.current = true;
    setPersonalProfileLoading(true);
    void mutations.ensurePersonalProfile()
      .then((nextProfile) => {
        if (!cancelled) {
          setPersonalProfile(nextProfile);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          autoLoadedPersonalProfileRef.current = false;
          setFeedback(error instanceof Error
            ? error.message
            : "Could not load personal cloud defaults.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setPersonalProfileLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [autoLoadPersonalProfile, mutations.ensurePersonalProfile, personalProfile]);

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
    credentialId: string,
  ) {
    if (!credentialId) {
      return;
    }
    setFeedback(null);
    try {
      const profile = await ensureOrganizationProfileLoaded();
      const selectedCredential = (organizationCredentials.data ?? []).find(
        (credential) => credential.id === credentialId && credential.agentKind === agentKind,
      );
      await mutations.selectCredential({
        sandboxProfileId: profile.id,
        agentKind,
        selection: {
          credentialId,
          credentialShareId: selectedCredential?.ownerUserId === currentUserId
            ? null
            : selectedCredential?.activeCredentialShareId ?? null,
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
