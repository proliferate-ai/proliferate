import { useMemo } from "react";
import type { AgentAuthAgentKind } from "@proliferate/cloud-sdk";
import { AuthenticationMethodsSection } from "@/components/settings/panes/agent-authentication/AuthenticationMethodsSection";
import { PersonalAuthInUseSection } from "@/components/settings/panes/agent-authentication/PersonalAuthInUseSection";
import { useAgentAuthLibraryActions } from "@/hooks/settings/workflows/use-agent-auth-library-actions";

interface CloudAgentAuthLibraryProps {
  initialAgentKind?: AgentAuthAgentKind | null;
}

export function CloudAgentAuthLibrary({ initialAgentKind = null }: CloudAgentAuthLibraryProps) {
  const library = useAgentAuthLibraryActions(initialAgentKind);
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
            each harness.
          </p>
        </div>
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
        selecting={library.selectingPersonalDefault}
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
        ensuringFreeCredits={library.ensuringFreeCredits}
        syncingLocalProvider={library.syncingLocalProvider}
        onRescan={library.handleRescan}
        onRevokeCredential={library.handleRevokeCredential}
        onEnsureFreeCredits={library.handleEnsureFreeCredits}
        onSyncLocalCredential={library.handleSyncLocalCredential}
      />
    </div>
  );
}
