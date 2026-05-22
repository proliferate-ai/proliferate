import type { AgentAuthAgentKind } from "@proliferate/cloud-sdk";
import { Select } from "@/components/ui/Select";
import { SettingsCard } from "@/components/settings/shared/SettingsCard";
import { SettingsCardRow } from "@/components/settings/shared/SettingsCardRow";
import { CloudAgentAuthCredentialForm } from "@/components/settings/panes/agent-authentication/CloudAgentAuthCredentialForm";
import { AgentAuthPersonalCredentialCard } from "@/components/settings/panes/agent-authentication/AgentAuthPersonalCredentialCard";
import { AgentAuthTeamDefaultsSection } from "@/components/settings/panes/agent-authentication/AgentAuthTeamDefaultsSection";
import {
  useAgentAuthLibraryActions,
  type AgentAuthLibraryOrganizationOption,
} from "@/hooks/settings/workflows/use-agent-auth-library-actions";
import type { AgentAuthProvider } from "@/hooks/access/tauri/use-credentials-actions";
import { agentAuthenticationCopy } from "@/copy/settings/agent-authentication-copy";
import { AGENT_AUTH_AGENT_ORDER } from "@/lib/domain/agent-auth/agent-auth-presentation";

interface CloudAgentAuthLibraryProps {
  initialAgentKind?: AgentAuthAgentKind | null;
}

export function CloudAgentAuthLibrary({ initialAgentKind = null }: CloudAgentAuthLibraryProps) {
  const library = useAgentAuthLibraryActions(initialAgentKind);
  const showGatewayCredentialForm = library.capabilities?.enabled === true
    && library.capabilities.byokEnabled === true;
  const credentialLoadError = library.personalCredentialsError
    ?? library.organizationCredentialsError;

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div className="space-y-1">
          <h2 className="text-sm font-medium text-foreground">
            {agentAuthenticationCopy.myCredentialsTitle}
          </h2>
          <p className="max-w-2xl text-xs leading-4 text-muted-foreground">
            {agentAuthenticationCopy.myCredentialsDescription}
          </p>
        </div>

        {library.organizationOptions.length > 0 && (
          <TeamUseScopeCard
            organizations={library.organizationOptions}
            selectedOrganizationId={library.selectedOrganizationId}
            isAdminForSelectedOrganization={library.isAdminForSelectedOrganization}
            onSelectedOrganizationChange={library.setSelectedOrganizationId}
          />
        )}

        {(library.feedback || library.localSourceError || credentialLoadError) && (
          <p className="text-xs text-muted-foreground">
            {library.feedback
              ?? library.localSourceError
              ?? "Could not load cloud credentials. Try again in a moment."}
          </p>
        )}

        <div className="grid gap-4">
          {AGENT_AUTH_AGENT_ORDER.map((agentKind) => {
            const provider = providerForAgentKind(agentKind);
            return (
              <AgentAuthPersonalCredentialCard
                key={agentKind}
                agentKind={agentKind}
                credentials={library.personalCredentialsByAgent.get(agentKind) ?? []}
                credentialsLoading={library.personalCredentialsLoading
                  || library.organizationCredentialsLoading}
                localSource={provider
                  ? library.localSourcesByProvider.get(provider) ?? null
                  : null}
                localSourceError={library.localSourceError}
                capabilities={library.capabilities}
                currentUserId={library.currentUserId}
                selectedOrganizationName={library.selectedOrganization?.name ?? null}
                syncingLocalProvider={library.syncingLocalProvider}
                rescanning={library.rescanning}
                sharingCredentialId={library.sharingCredentialId}
                revokingShareId={library.revokingShareId}
                revokingCredentialId={library.revokingCredentialId}
                focused={library.focusedAgentKind === agentKind}
                onSyncLocalCredential={library.handleSyncLocalCredential}
                onRescan={library.handleRescan}
                onShare={library.handleShareCredential}
                onRevokeShare={library.handleRevokeShare}
                onRevokeCredential={library.handleRevokeCredential}
              />
            );
          })}
        </div>
      </section>

      {library.selectedOrganization && library.isAdminForSelectedOrganization && (
        <AgentAuthTeamDefaultsSection
          selectedOrganizationName={library.selectedOrganization.name}
          credentials={library.organizationCredentials}
          currentUserId={library.currentUserId}
          capabilities={library.capabilities}
          organizationProfile={library.organizationProfile}
          selections={library.selections}
          ensuringProfile={library.ensuringProfile}
          ensuringManagedCredits={library.ensuringManagedCredits}
          selectingTeamDefault={library.selectingTeamDefault}
          revokingCredentialId={library.revokingCredentialId}
          onEnsureOrganizationProfile={library.handleEnsureOrganizationProfile}
          onEnsureManagedCredits={library.handleEnsureManagedCredits}
          onSelectTeamDefault={library.handleSelectTeamDefault}
          onRevokeCredential={library.handleRevokeCredential}
        />
      )}

      {showGatewayCredentialForm && (
        <section className="space-y-3 border-t border-border pt-6">
          <div className="space-y-1">
            <h2 className="text-sm font-medium text-foreground">
              {agentAuthenticationCopy.gatewayCredentialsTitle}
            </h2>
            <p className="max-w-2xl text-xs leading-4 text-muted-foreground">
              {agentAuthenticationCopy.gatewayCredentialsDescription}
            </p>
          </div>
          <CloudAgentAuthCredentialForm
            organizations={library.organizationOptions}
            selectedOrganizationId={library.selectedOrganizationId}
            onSelectedOrganizationChange={library.setSelectedOrganizationId}
            agentGatewayCapabilities={library.capabilities}
          />
        </section>
      )}
    </div>
  );
}

function TeamUseScopeCard({
  organizations,
  selectedOrganizationId,
  isAdminForSelectedOrganization,
  onSelectedOrganizationChange,
}: {
  organizations: AgentAuthLibraryOrganizationOption[];
  selectedOrganizationId: string | null;
  isAdminForSelectedOrganization: boolean;
  onSelectedOrganizationChange: (organizationId: string | null) => void;
}) {
  return (
    <SettingsCard>
      <SettingsCardRow
        label={agentAuthenticationCopy.teamUseTitle}
        description={isAdminForSelectedOrganization
          ? agentAuthenticationCopy.teamUseAdminDescription
          : agentAuthenticationCopy.teamUseMemberDescription}
      >
        <Select
          className="w-64"
          value={selectedOrganizationId ?? ""}
          aria-label="Team for credential sharing"
          onChange={(event) => onSelectedOrganizationChange(event.target.value || null)}
        >
          {organizations.map((organization) => (
            <option key={organization.id} value={organization.id}>
              {organization.name}
            </option>
          ))}
        </Select>
      </SettingsCardRow>
    </SettingsCard>
  );
}

function providerForAgentKind(agentKind: AgentAuthAgentKind): AgentAuthProvider | null {
  if (agentKind === "claude" || agentKind === "codex" || agentKind === "gemini") {
    return agentKind;
  }
  return null;
}
