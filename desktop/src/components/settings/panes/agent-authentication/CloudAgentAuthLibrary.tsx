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
import { CloudAgentAuthCredentialForm } from "@/components/settings/panes/agent-authentication/CloudAgentAuthCredentialForm";
import { AgentAuthHarnessSection } from "@/components/settings/panes/agent-authentication/AgentAuthHarnessSection";
import { AgentAuthManagedCreditsCard } from "@/components/settings/panes/agent-authentication/AgentAuthManagedCreditsCard";
import { AgentAuthTeamSyncOverview } from "@/components/settings/panes/agent-authentication/AgentAuthTeamSyncOverview";
import { Circle } from "@/components/ui/icons";
import {
  useTauriCredentialsActions,
  type AgentAuthProvider,
  type LocalAgentAuthSource,
} from "@/hooks/access/tauri/use-credentials-actions";
import { useOrganizations } from "@/hooks/access/cloud/organizations/use-organizations";
import { useAuthStore } from "@/stores/auth/auth-store";
import { agentAuthenticationCopy } from "@/copy/settings/agent-authentication-copy";
import {
  AGENT_AUTH_AGENT_ORDER,
  agentAuthAgentLabel,
  isAgentAuthAdminRole,
  isProliferateManagedCreditsCredential,
  selectionByAgentKind,
} from "@/lib/domain/agent-auth/agent-auth-presentation";

type OrganizationOption = NonNullable<ReturnType<typeof useOrganizations>["data"]>["organizations"][number];

export function CloudAgentAuthLibrary() {
  const organizations = useOrganizations();
  const [libraryOrganizationId, setLibraryOrganizationId] = useState<string | null>(null);
  const { data: credentials = [] } = useAgentAuthCredentials({
    organizationId: libraryOrganizationId,
  });
  const { data: capabilities } = useCloudCapabilities();
  const agentGatewayCapabilities = capabilities?.agentGateway ?? null;
  const mutations = useAgentAuthMutations();
  const {
    exportSyncableAgentAuthCredential,
    listSyncableAgentAuthCredentials,
  } = useTauriCredentialsActions();
  const [feedback, setFeedback] = useState<string | null>(null);
  const [sharingCredentialId, setSharingCredentialId] = useState<string | null>(null);
  const [revokingShareId, setRevokingShareId] = useState<string | null>(null);
  const [revokingCredentialId, setRevokingCredentialId] = useState<string | null>(null);
  const [localSources, setLocalSources] = useState<LocalAgentAuthSource[]>([]);
  const [syncingLocalProvider, setSyncingLocalProvider] = useState<AgentAuthProvider | null>(
    null,
  );
  const [rescanning, setRescanning] = useState(false);
  const [organizationProfile, setOrganizationProfile] = useState<SandboxProfile | null>(null);
  const currentUserId = useAuthStore((state) => state.user?.id ?? null);
  const organizationOptions = organizations.data?.organizations ?? [];
  const adminOrganizationIds = useMemo(
    () => new Set(
      organizationOptions
        .filter(isAdminOrganization)
        .map((organization) => organization.id),
    ),
    [organizationOptions],
  );
  const isAdminForLibraryOrganization = Boolean(
    libraryOrganizationId && adminOrganizationIds.has(libraryOrganizationId),
  );
  const selectedOrganization = organizationOptions.find(
    (organization) => organization.id === libraryOrganizationId,
  ) ?? null;
  const { data: selections = [] } = useSandboxAgentAuthSelections(
    organizationProfile?.id ?? null,
  );
  const selectionsByAgent = useMemo(() => selectionByAgentKind(selections), [selections]);
  const localSourcesByProvider = useMemo(
    () => new Map(localSources.map((source) => [source.provider, source])),
    [localSources],
  );
  const groupedCredentials = useMemo(
    () => groupCredentialsByAgent(credentials),
    [credentials],
  );

  useEffect(() => {
    setOrganizationProfile(null);
  }, [libraryOrganizationId]);

  useEffect(() => {
    let cancelled = false;
    void loadLocalSources(listSyncableAgentAuthCredentials, setRescanning)
      .then((sources) => {
        if (!cancelled) {
          setLocalSources(sources);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLocalSources([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [listSyncableAgentAuthCredentials]);

  async function handleRescan() {
    setFeedback(null);
    try {
      const sources = await loadLocalSources(listSyncableAgentAuthCredentials, setRescanning);
      setLocalSources(sources);
      setFeedback("Local credentials scanned.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Could not scan local credentials.");
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
    if (!libraryOrganizationId) {
      setFeedback("Select an organization scope before sharing.");
      return;
    }
    setSharingCredentialId(credential.id);
    setFeedback(null);
    try {
      await mutations.createShare({
        credentialId: credential.id,
        organizationId: libraryOrganizationId,
      });
      setFeedback(`${credential.displayName} shared with organization.`);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Could not share credential.");
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
      setFeedback(`${credential.displayName} share revoked.`);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Could not revoke share.");
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
    if (!libraryOrganizationId) {
      return;
    }
    setFeedback(null);
    try {
      const nextProfile = await mutations.ensureOrganizationProfile({
        organizationId: libraryOrganizationId,
      });
      setOrganizationProfile(nextProfile);
      setFeedback("Shared sandbox auth defaults loaded.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Could not load shared sandbox auth.");
    }
  }

  async function handleEnsureManagedCredits() {
    if (!libraryOrganizationId) {
      return;
    }
    setFeedback(null);
    try {
      await mutations.ensureManagedCredits({
        organizationId: libraryOrganizationId,
      });
      setFeedback("Managed credits are ready for the organization.");
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
          credentialShareId: credentials.find(
            (credential) => credential.id === credentialId && credential.agentKind === agentKind,
          )?.activeCredentialShareId ?? null,
        },
      });
      setFeedback(`${agentAuthAgentLabel(agentKind)} team default saved.`);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Could not save team default.");
    }
  }

  const managedCreditsCredentials = credentials.filter(isProliferateManagedCreditsCredential);
  const teamOverviewCredentials = credentials.filter(
    (credential) => credential.credentialKind === "synced_path",
  );

  return (
    <div className="space-y-6">
      {adminOrganizationIds.size > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-border-light bg-foreground/5 px-3 py-2 text-xs leading-4 text-muted-foreground">
          <Circle className="mt-0.5 size-3 shrink-0" />
          <span>{agentAuthenticationCopy.adminHint}</span>
        </div>
      )}

      <CloudAgentAuthCredentialForm
        organizations={organizationOptions}
        libraryOrganizationId={libraryOrganizationId}
        onLibraryOrganizationChange={setLibraryOrganizationId}
        agentGatewayCapabilities={agentGatewayCapabilities}
      />

      <AgentAuthManagedCreditsCard
        capabilities={agentGatewayCapabilities}
        selectedOrganizationName={selectedOrganization?.name ?? null}
        isAdminForLibraryOrganization={isAdminForLibraryOrganization}
        managedCredentials={managedCreditsCredentials}
        ensuring={mutations.isEnsuringManagedCredits}
        onEnsureManagedCredits={handleEnsureManagedCredits}
      />

      {feedback && <p className="text-xs text-muted-foreground">{feedback}</p>}

      {AGENT_AUTH_AGENT_ORDER.map((agentKind) => (
        <AgentAuthHarnessSection
          key={agentKind}
          agentKind={agentKind}
          credentials={groupedCredentials.get(agentKind) ?? []}
          localSource={localSourcesByProvider.get(agentKind as AgentAuthProvider) ?? null}
          capabilities={agentGatewayCapabilities}
          currentUserId={currentUserId}
          adminOrganizationIds={adminOrganizationIds}
          libraryOrganizationId={libraryOrganizationId}
          organizationProfile={organizationProfile}
          teamSelection={selectionsByAgent.get(agentKind)}
          isAdminForLibraryOrganization={isAdminForLibraryOrganization}
          syncingLocalProvider={syncingLocalProvider}
          rescanning={rescanning}
          sharingCredentialId={sharingCredentialId}
          revokingShareId={revokingShareId}
          revokingCredentialId={revokingCredentialId}
          selectingTeamDefault={mutations.isSelectingCredential}
          ensuringProfile={mutations.isEnsuringProfile}
          onSyncLocalCredential={handleSyncLocalCredential}
          onRescan={handleRescan}
          onShare={handleShareCredential}
          onRevokeShare={handleRevokeShare}
          onRevokeCredential={handleRevokeCredential}
          onEnsureOrganizationProfile={handleEnsureOrganizationProfile}
          onSelectTeamDefault={handleSelectTeamDefault}
        />
      ))}

      {isAdminForLibraryOrganization && (
        <AgentAuthTeamSyncOverview
          credentials={teamOverviewCredentials}
          currentUserId={currentUserId}
        />
      )}
    </div>
  );
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

function isAdminOrganization(organization: OrganizationOption): boolean {
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
