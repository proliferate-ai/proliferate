import type {
  AgentAuthAgentKind,
  AgentAuthCredential,
  AgentGatewayCapabilities,
  SandboxAgentAuthSelection,
  SandboxProfile,
} from "@proliferate/cloud-sdk";
import { Button } from "@proliferate/ui/primitives/Button";
import { Badge } from "@/components/ui/Badge";
import { Select } from "@/components/ui/Select";
import { SettingsCard } from "@/components/settings/shared/SettingsCard";
import { SettingsCardRow } from "@/components/settings/shared/SettingsCardRow";
import { Plus, Terminal } from "@/components/ui/icons";
import type {
  AgentAuthProvider,
  LocalAgentAuthSource,
} from "@/hooks/access/tauri/use-credentials-actions";
import { agentAuthenticationCopy } from "@/copy/settings/agent-authentication-copy";
import { AgentAuthAdminTag } from "@/components/settings/panes/agent-authentication/AgentAuthAdminTag";
import { AgentAuthCredentialFooter } from "@/components/settings/panes/agent-authentication/AgentAuthCredentialFooter";
import {
  agentAuthAgentLabel,
  agentAuthCanCreateGatewayCredentialForAgent,
  agentAuthCredentialAvailability,
  agentAuthCredentialKindLabel,
  agentAuthHarnessDescription,
  credentialSelectableReason,
} from "@/lib/domain/agent-auth/agent-auth-presentation";

interface AgentAuthHarnessSectionProps {
  agentKind: AgentAuthAgentKind;
  credentials: AgentAuthCredential[];
  localSource: LocalAgentAuthSource | null;
  capabilities: AgentGatewayCapabilities | null;
  currentUserId: string | null;
  adminOrganizationIds: ReadonlySet<string>;
  libraryOrganizationId: string | null;
  organizationProfile: SandboxProfile | null;
  teamSelection: SandboxAgentAuthSelection | undefined;
  isAdminForLibraryOrganization: boolean;
  syncingLocalProvider: AgentAuthProvider | null;
  rescanning: boolean;
  sharingCredentialId: string | null;
  revokingShareId: string | null;
  revokingCredentialId: string | null;
  selectingTeamDefault: boolean;
  ensuringProfile: boolean;
  onSyncLocalCredential: (provider: AgentAuthProvider) => void;
  onRescan: () => void;
  onShare: (credential: AgentAuthCredential) => void;
  onRevokeShare: (credential: AgentAuthCredential) => void;
  onRevokeCredential: (credential: AgentAuthCredential) => void;
  onEnsureOrganizationProfile: () => void;
  onSelectTeamDefault: (agentKind: AgentAuthAgentKind, credentialId: string) => void;
  onAddCredential: (agentKind: AgentAuthAgentKind) => void;
}

export function AgentAuthHarnessSection({
  agentKind,
  credentials,
  localSource,
  capabilities,
  currentUserId,
  adminOrganizationIds,
  libraryOrganizationId,
  organizationProfile,
  teamSelection,
  isAdminForLibraryOrganization,
  syncingLocalProvider,
  rescanning,
  sharingCredentialId,
  revokingShareId,
  revokingCredentialId,
  selectingTeamDefault,
  ensuringProfile,
  onSyncLocalCredential,
  onRescan,
  onShare,
  onRevokeShare,
  onRevokeCredential,
  onEnsureOrganizationProfile,
  onSelectTeamDefault,
  onAddCredential,
}: AgentAuthHarnessSectionProps) {
  const syncProvider = localSource?.provider ?? null;
  const canSync = syncProvider !== null && localSource?.detected === true;
  const readyCredentialCount = credentials.filter((credential) => credential.status === "ready").length;
  const authenticated = canSync || readyCredentialCount > 0;
  const detectedCount = credentials.length + (localSource ? 1 : 0);
  const canCreateGatewayCredential = agentAuthCanCreateGatewayCredentialForAgent(
    agentKind,
    capabilities,
  );
  return (
    <section className="space-y-3">
      <div className="space-y-1">
        <h2 className="text-sm font-medium text-foreground">
          {agentAuthAgentLabel(agentKind)}
        </h2>
        <p className="text-xs text-muted-foreground">
          {agentAuthHarnessDescription(agentKind)}
        </p>
      </div>

      <SettingsCard>
        <div className="flex items-center gap-3 px-4 py-3">
          <HarnessIcon agentKind={agentKind} />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-foreground">
              {agentAuthAgentLabel(agentKind)}
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              Installed - {authenticated ? "Authenticated" : "Needs authentication"}
            </div>
          </div>
          <Badge tone={authenticated ? "success" : "neutral"}>
            {authenticated ? "Authenticated" : "Not authenticated"}
          </Badge>
        </div>

        <SettingsCardRow
          label={agentAuthenticationCopy.syncRowTitle}
          description={localSource
            ? agentAuthenticationCopy.syncRowDescription
            : "Native sync for this harness is not exposed by Desktop yet."}
        >
          <Button
            type="button"
            variant="secondary"
            size="sm"
            loading={syncingLocalProvider === syncProvider}
            disabled={!canSync || syncProvider === null}
            onClick={() => {
              if (syncProvider) {
                onSyncLocalCredential(syncProvider);
              }
            }}
          >
            {localSource
              ? localSource.detected ? "Sync active credential" : "No local auth"
              : "Not supported"}
          </Button>
        </SettingsCardRow>

        {isAdminForLibraryOrganization && (
          <TeamDefaultRow
            agentKind={agentKind}
            credentials={credentials}
            capabilities={capabilities}
            organizationProfile={organizationProfile}
            selection={teamSelection}
            selecting={selectingTeamDefault}
            ensuringProfile={ensuringProfile}
            onEnsureOrganizationProfile={onEnsureOrganizationProfile}
            onSelectTeamDefault={onSelectTeamDefault}
          />
        )}

        <AgentAuthCredentialFooter
          agentKind={agentKind}
          credentials={credentials}
          localSource={localSource}
          capabilities={capabilities}
          currentUserId={currentUserId}
          adminOrganizationIds={adminOrganizationIds}
          libraryOrganizationId={libraryOrganizationId}
          detectedCount={detectedCount}
          rescanning={rescanning}
          sharingCredentialId={sharingCredentialId}
          revokingShareId={revokingShareId}
          revokingCredentialId={revokingCredentialId}
          onRescan={onRescan}
          onShare={onShare}
          onRevokeShare={onRevokeShare}
          onRevokeCredential={onRevokeCredential}
        />

        <button
          type="button"
          className="flex min-h-10 w-full items-center justify-center gap-2 border-t border-border-light px-4 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          disabled={!canCreateGatewayCredential}
          onClick={() => onAddCredential(agentKind)}
        >
          <Plus className="size-3.5" />
          {canCreateGatewayCredential
            ? "Add gateway credential"
            : "BYOK provider forms hidden in hosted cloud"}
        </button>
      </SettingsCard>
    </section>
  );
}

function TeamDefaultRow({
  agentKind,
  credentials,
  capabilities,
  organizationProfile,
  selection,
  selecting,
  ensuringProfile,
  onEnsureOrganizationProfile,
  onSelectTeamDefault,
}: {
  agentKind: AgentAuthAgentKind;
  credentials: AgentAuthCredential[];
  capabilities: AgentGatewayCapabilities | null;
  organizationProfile: SandboxProfile | null;
  selection: SandboxAgentAuthSelection | undefined;
  selecting: boolean;
  ensuringProfile: boolean;
  onEnsureOrganizationProfile: () => void;
  onSelectTeamDefault: (agentKind: AgentAuthAgentKind, credentialId: string) => void;
}) {
  if (!organizationProfile) {
    return (
      <SettingsCardRow
        label={<span>{agentAuthenticationCopy.teamDefaultTitle} <AgentAuthAdminTag /></span>}
        description={agentAuthenticationCopy.teamDefaultDescription}
      >
        <Button
          type="button"
          variant="secondary"
          size="sm"
          loading={ensuringProfile}
          onClick={() => onEnsureOrganizationProfile()}
        >
          Load defaults
        </Button>
      </SettingsCardRow>
    );
  }

  const selectedCredentialId = selection?.credentialId ?? "";
  const selectedCredential = selectedCredentialId
    ? credentials.find((credential) => credential.id === selectedCredentialId)
    : null;
  return (
    <SettingsCardRow
      label={<span>{agentAuthenticationCopy.teamDefaultTitle} <AgentAuthAdminTag /></span>}
      description={agentAuthenticationCopy.teamDefaultDescription}
    >
      <Select
        className="w-64"
        value={selectedCredentialId}
        disabled={selecting}
        aria-label={`${agentAuthAgentLabel(agentKind)} team default`}
        onChange={(event) => onSelectTeamDefault(agentKind, event.target.value)}
      >
        <option value="">Not set</option>
        {selection && !selectedCredential && (
          <option value={selectedCredentialId} disabled>
            Selected credential unavailable
          </option>
        )}
        {credentials.map((credential) => {
          const availability = agentAuthCredentialAvailability(credential, capabilities);
          const disabledReason = availability.reason
            ?? credentialSelectableReason(credential, organizationProfile.ownerScope);
          const disabledLabel = availability.reason ? availability.label : disabledReason;
          return (
            <option
              key={credential.id}
              value={credential.id}
              disabled={disabledReason !== null}
            >
              {credential.displayName} - {agentAuthCredentialKindLabel(credential)}
              {disabledLabel ? ` - ${disabledLabel}` : ""}
            </option>
          );
        })}
      </Select>
    </SettingsCardRow>
  );
}

function HarnessIcon({ agentKind }: { agentKind: AgentAuthAgentKind }) {
  return (
    <div className="flex size-7 shrink-0 items-center justify-center text-foreground">
      {agentKind === "opencode" ? (
        <Terminal className="size-4" />
      ) : (
        <span className="text-sm font-semibold">{agentAuthAgentLabel(agentKind).slice(0, 1)}</span>
      )}
    </div>
  );
}
