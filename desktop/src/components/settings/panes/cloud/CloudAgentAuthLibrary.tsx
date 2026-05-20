import { useMemo, useState } from "react";
import type { AgentAuthCredential } from "@proliferate/cloud-sdk";
import { Button } from "@proliferate/ui/primitives/Button";
import { Badge } from "@/components/ui/Badge";
import { SettingsCard } from "@/components/settings/shared/SettingsCard";
import { SettingsCardRow } from "@/components/settings/shared/SettingsCardRow";
import { CloudAgentAuthCredentialForm } from "@/components/settings/panes/cloud/CloudAgentAuthCredentialForm";
import { AGENT_GATEWAY_BYOK_ENABLED } from "@/config/agent-auth";
import {
  useAgentAuthCredentials,
  useAgentAuthMutations,
} from "@/hooks/access/cloud/agent-auth/use-agent-auth";
import { useOrganizations } from "@/hooks/access/cloud/organizations/use-organizations";
import {
  AGENT_AUTH_AGENT_ORDER,
  agentAuthAgentLabel,
  agentAuthCredentialKindLabel,
  agentAuthCredentialOwnerLabel,
  agentAuthCredentialStatusLabel,
  agentAuthCredentialStatusTone,
  describeAgentAuthCredential,
  isHostedCloudV1AgentAuthCredential,
  isProliferateManagedCreditsCredential,
} from "@/lib/domain/agent-auth/agent-auth-presentation";
import { useAuthStore } from "@/stores/auth/auth-store";

export function CloudAgentAuthLibrary() {
  const organizations = useOrganizations();
  const [libraryOrganizationId, setLibraryOrganizationId] = useState<string | null>(null);
  const { data: credentials = [] } = useAgentAuthCredentials({
    organizationId: libraryOrganizationId,
  });
  const mutations = useAgentAuthMutations();
  const [feedback, setFeedback] = useState<string | null>(null);
  const [sharingCredentialId, setSharingCredentialId] = useState<string | null>(null);
  const [revokingCredentialId, setRevokingCredentialId] = useState<string | null>(null);
  const currentUserId = useAuthStore((state) => state.user?.id ?? null);
  const adminOrganizationIds = useMemo(
    () => new Set(
      (organizations.data?.organizations ?? [])
        .filter((organization) => {
          const role = organization.membership?.role;
          return role === "owner" || role === "admin";
        })
        .map((organization) => organization.id),
    ),
    [organizations.data?.organizations],
  );

  const visibleCredentials = useMemo(
    () =>
      AGENT_GATEWAY_BYOK_ENABLED
        ? credentials
        : credentials.filter(isHostedCloudV1AgentAuthCredential),
    [credentials],
  );
  const grouped = useMemo(() => groupCredentialsByAgent(visibleCredentials), [visibleCredentials]);

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

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <h2 className="text-sm font-medium text-foreground">Agent auth library</h2>
        <p className="text-sm text-muted-foreground">
          Gateway and synced credentials available to cloud agent harnesses.
        </p>
      </div>

      <CloudAgentAuthCredentialForm
        organizations={organizations.data?.organizations ?? []}
        libraryOrganizationId={libraryOrganizationId}
        onLibraryOrganizationChange={setLibraryOrganizationId}
        gatewayByokEnabled={AGENT_GATEWAY_BYOK_ENABLED}
      />

      {feedback && <p className="text-xs text-muted-foreground">{feedback}</p>}

      {AGENT_AUTH_AGENT_ORDER.map((kind) => (
        <AgentCredentialGroup
          key={kind}
          title={agentAuthAgentLabel(kind)}
          credentials={grouped.get(kind) ?? []}
          sharingCredentialId={sharingCredentialId}
          revokingCredentialId={revokingCredentialId}
          sharingEnabled={Boolean(libraryOrganizationId)}
          currentUserId={currentUserId}
          adminOrganizationIds={adminOrganizationIds}
          onShare={handleShareCredential}
          onRevoke={handleRevokeCredential}
        />
      ))}
    </div>
  );
}

function AgentCredentialGroup({
  title,
  credentials,
  sharingCredentialId,
  revokingCredentialId,
  sharingEnabled,
  currentUserId,
  adminOrganizationIds,
  onShare,
  onRevoke,
}: {
  title: string;
  credentials: AgentAuthCredential[];
  sharingCredentialId: string | null;
  revokingCredentialId: string | null;
  sharingEnabled: boolean;
  currentUserId: string | null;
  adminOrganizationIds: ReadonlySet<string>;
  onShare: (credential: AgentAuthCredential) => void;
  onRevoke: (credential: AgentAuthCredential) => void;
}) {
  if (credentials.length === 0) {
    return null;
  }
  return (
    <SettingsCard>
      <div className="px-4 py-2 text-xs font-medium text-muted-foreground">{title}</div>
      {credentials.map((credential) => {
        const canShare = credential.ownerScope === "personal"
          && credential.credentialKind === "synced_path";
        const canManage = canManageCredential(
          credential,
          currentUserId,
          adminOrganizationIds,
        ) && !isProliferateManagedCreditsCredential(credential);
        return (
          <SettingsCardRow
            key={credential.id}
            label={credential.displayName}
            description={`${agentAuthCredentialKindLabel(credential)} · ${describeAgentAuthCredential(credential)}`}
          >
            <div className="flex items-center gap-2">
              <span className="hidden text-xs text-muted-foreground sm:inline">
                {agentAuthCredentialOwnerLabel(credential)}
              </span>
              <Badge tone={agentAuthCredentialStatusTone(credential.status)}>
                {agentAuthCredentialStatusLabel(credential.status)}
              </Badge>
              {canShare && credential.ownerUserId === currentUserId && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!sharingEnabled}
                  loading={sharingCredentialId === credential.id}
                  onClick={() => onShare(credential)}
                >
                  Share
                </Button>
              )}
              {canManage && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  loading={revokingCredentialId === credential.id}
                  onClick={() => onRevoke(credential)}
                >
                  Revoke
                </Button>
              )}
            </div>
          </SettingsCardRow>
        );
      })}
    </SettingsCard>
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

function canManageCredential(
  credential: AgentAuthCredential,
  currentUserId: string | null,
  adminOrganizationIds: ReadonlySet<string>,
): boolean {
  if (credential.ownerScope === "personal") {
    return credential.ownerUserId === currentUserId;
  }
  if (credential.ownerScope === "organization" && credential.organizationId) {
    return adminOrganizationIds.has(credential.organizationId);
  }
  return false;
}
