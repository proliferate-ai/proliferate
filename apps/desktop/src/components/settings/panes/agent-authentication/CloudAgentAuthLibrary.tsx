import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import type { AgentAuthAgentKind } from "@proliferate/cloud-sdk";
import { Button } from "@proliferate/ui/primitives/Button";
import { SettingsCard } from "@/components/settings/shared/SettingsCard";
import { SettingsCardRow } from "@/components/settings/shared/SettingsCardRow";
import { AuthenticationMethodsSection } from "@/components/settings/panes/agent-authentication/AuthenticationMethodsSection";
import { PersonalAuthInUseSection } from "@/components/settings/panes/agent-authentication/PersonalAuthInUseSection";
import { useAgentAuthLibraryActions } from "@/hooks/settings/workflows/use-agent-auth-library-actions";
import { buildSettingsHref } from "@/lib/domain/settings/navigation";

interface CloudAgentAuthLibraryProps {
  initialAgentKind?: AgentAuthAgentKind | null;
}

export function CloudAgentAuthLibrary({ initialAgentKind = null }: CloudAgentAuthLibraryProps) {
  const library = useAgentAuthLibraryActions(initialAgentKind);
  const navigate = useNavigate();
  const credentialLoadError = library.personalCredentialsError;
  const personalCredentials = useMemo(
    () => [...library.personalCredentialsByProvider.values()].flat(),
    [library.personalCredentialsByProvider],
  );

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div className="space-y-1">
          <h2 className="text-sm font-medium text-foreground">
            Personal sandbox authentication
          </h2>
          <p className="max-w-2xl text-xs leading-4 text-muted-foreground">
            Choose what your local sandbox and personal cloud sandboxes use for
            each harness. Team-wide work is configured in Shared Sandbox.
          </p>
        </div>
        <SettingsCard>
          <SettingsCardRow
            label="Team-wide work"
            description="Slack-created workspaces, shared team workspaces, shared team automations, and API-dispatched workspaces use the Shared Sandbox settings."
          >
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => navigate(buildSettingsHref({ section: "shared-environments" }))}
            >
              Open Shared Sandbox
            </Button>
          </SettingsCardRow>
        </SettingsCard>
      </section>

      {(library.feedback || library.localSourceError || credentialLoadError) && (
        <p className="text-xs leading-4 text-muted-foreground">
          {library.feedback
            ?? library.localSourceError
            ?? "Could not load personal cloud credentials. Try again in a moment."}
        </p>
      )}

      <PersonalAuthInUseSection
        capabilities={library.capabilities}
        credentialsByProvider={library.personalCredentialsByProvider}
        credentialsLoading={library.personalCredentialsLoading}
        localSourceError={library.localSourceError}
        localSourcesByProvider={library.localSourcesByProvider}
        personalSelections={library.personalSelections}
        rescanning={library.rescanning}
        ensuringFreeCredits={library.ensuringFreeCredits}
        selecting={library.selectingTeamDefault}
        syncingLocalProvider={library.syncingLocalProvider}
        onEnsureFreeCredits={library.handleEnsureFreeCredits}
        onEnsurePersonalProfile={library.handleEnsurePersonalProfile}
        onRescan={library.handleRescan}
        onSelectPersonalDefault={library.handleSelectPersonalDefault}
        onSyncLocalCredential={library.handleSyncLocalCredential}
      />

      <AuthenticationMethodsSection
        capabilities={library.capabilities}
        currentUserId={library.currentUserId}
        localSourcesByProvider={library.localSourcesByProvider}
        personalCredentials={personalCredentials}
        rescanning={library.rescanning}
        revokingCredentialId={library.revokingCredentialId}
        revokingShareId={library.revokingShareId}
        sharingCredentialId={library.sharingCredentialId}
        ensuringFreeCredits={library.ensuringFreeCredits}
        syncingLocalProvider={library.syncingLocalProvider}
        organizations={library.organizationOptions}
        selectedOrganizationId={library.selectedOrganizationId}
        onSelectedOrganizationChange={library.setSelectedOrganizationId}
        onRescan={library.handleRescan}
        onRevokeCredential={library.handleRevokeCredential}
        onRevokeShare={library.handleRevokeShare}
        onShareCredential={library.handleShareCredential}
        onEnsureFreeCredits={library.handleEnsureFreeCredits}
        onSyncLocalCredential={library.handleSyncLocalCredential}
      />
    </div>
  );
}
