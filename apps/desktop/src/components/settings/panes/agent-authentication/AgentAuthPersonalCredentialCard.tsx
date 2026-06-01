import { useState } from "react";
import type {
  AgentAuthAgentKind,
  AgentAuthCredential,
  AgentGatewayCapabilities,
} from "@proliferate/cloud-sdk";
import { Button } from "@proliferate/ui/primitives/Button";
import { Badge } from "@proliferate/ui/primitives/Badge";
import { ConfirmationDialog } from "@proliferate/ui/primitives/ConfirmationDialog";
import { SettingsCard } from "@/components/settings/shared/SettingsCard";
import { SettingsCardRow } from "@/components/settings/shared/SettingsCardRow";
import { RefreshCw, Terminal } from "@proliferate/ui/icons";
import { PersonalCredentialRow } from "@/components/settings/panes/agent-authentication/PersonalCredentialRow";
import type {
  AgentAuthProvider,
  LocalAgentAuthSource,
} from "@/hooks/access/tauri/use-credentials-actions";
import { agentAuthenticationCopy } from "@/copy/settings/agent-authentication-copy";
import {
  agentAuthAgentLabel,
  agentAuthHarnessDescription,
} from "@/lib/domain/agent-auth/agent-auth-presentation";
import {
  cloudCredentialDescription,
  confirmationConfirmLabel,
  confirmationDescription,
  confirmationTitle,
  localAuthBadge,
  localAuthDescription,
  type PersonalCredentialConfirmationAction,
} from "@/lib/domain/agent-auth/personal-credential-presentation";

interface AgentAuthPersonalCredentialCardProps {
  agentKind: AgentAuthAgentKind;
  credentials: AgentAuthCredential[];
  credentialsLoading: boolean;
  localSource: LocalAgentAuthSource | null;
  localSourceError: string | null;
  capabilities: AgentGatewayCapabilities | null;
  currentUserId: string | null;
  selectedOrganizationName: string | null;
  syncingLocalProvider: AgentAuthProvider | null;
  rescanning: boolean;
  sharingCredentialId: string | null;
  revokingShareId: string | null;
  revokingCredentialId: string | null;
  focused: boolean;
  onSyncLocalCredential: (provider: AgentAuthProvider) => void;
  onRescan: () => void;
  onShare: (credential: AgentAuthCredential) => void;
  onRevokeShare: (credential: AgentAuthCredential) => void;
  onRevokeCredential: (credential: AgentAuthCredential) => void;
}

export function AgentAuthPersonalCredentialCard({
  agentKind,
  credentials,
  credentialsLoading,
  localSource,
  localSourceError,
  capabilities,
  currentUserId,
  selectedOrganizationName,
  syncingLocalProvider,
  rescanning,
  sharingCredentialId,
  revokingShareId,
  revokingCredentialId,
  focused,
  onSyncLocalCredential,
  onRescan,
  onShare,
  onRevokeShare,
  onRevokeCredential,
}: AgentAuthPersonalCredentialCardProps) {
  const [confirmationAction, setConfirmationAction] =
    useState<PersonalCredentialConfirmationAction | null>(null);
  const syncProvider = localSource?.provider ?? null;
  const canSync = syncProvider !== null && localSource?.detected === true;
  const authenticated = localSource?.detected === true
    || credentials.some((credential) => credential.status === "ready");
  const localBadge = localAuthBadge(localSource, localSourceError);
  return (
    <section id={`agent-auth-${agentKind}`}>
      <SettingsCard className={focused ? "ring-1 ring-ring" : ""}>
        <div className="flex items-start gap-3 px-4 py-3">
          <HarnessIcon agentKind={agentKind} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-medium text-foreground">
                {agentAuthAgentLabel(agentKind)}
              </h2>
              <Badge tone={authenticated ? "success" : "neutral"}>
                {authenticated ? "Authenticated" : "Needs auth"}
              </Badge>
            </div>
            <p className="mt-1 text-xs leading-4 text-muted-foreground">
              {agentAuthHarnessDescription(agentKind)}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            loading={rescanning}
            onClick={() => onRescan()}
          >
            <RefreshCw className="size-3.5" />
            Re-scan
          </Button>
        </div>

        <SettingsCardRow
          label={agentAuthenticationCopy.localAuthTitle}
          description={localAuthDescription(agentKind, localSource, localSourceError)}
        >
          <div className="flex items-center gap-2">
            <Badge tone={localBadge.tone}>{localBadge.label}</Badge>
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
              Sync active credential
            </Button>
          </div>
        </SettingsCardRow>

        <div className="border-t border-border-light">
          <div className="px-4 py-3">
            <div className="text-xs font-medium text-foreground">
              {agentAuthenticationCopy.cloudCredentialsTitle}
            </div>
            <div className="mt-1 text-xs leading-4 text-muted-foreground">
              {cloudCredentialDescription(credentials, credentialsLoading)}
            </div>
          </div>
          {!credentialsLoading && credentials.length > 0 && (
            <div className="divide-y divide-border-light border-t border-border-light">
              {credentials.map((credential) => (
                <PersonalCredentialRow
                  key={credential.id}
                  credential={credential}
                  capabilities={capabilities}
                  currentUserId={currentUserId}
                  selectedOrganizationName={selectedOrganizationName}
                  sharingCredentialId={sharingCredentialId}
                  revokingShareId={revokingShareId}
                  revokingCredentialId={revokingCredentialId}
                  onRequestAction={setConfirmationAction}
                />
              ))}
            </div>
          )}
        </div>
      </SettingsCard>
      <ConfirmationDialog
        open={confirmationAction !== null}
        title={confirmationTitle(confirmationAction)}
        description={confirmationDescription(confirmationAction, selectedOrganizationName)}
        confirmLabel={confirmationConfirmLabel(confirmationAction)}
        confirmVariant={confirmationAction?.kind === "share" ? "primary" : "destructive"}
        onClose={() => setConfirmationAction(null)}
        onConfirm={() => {
          const action = confirmationAction;
          setConfirmationAction(null);
          if (!action) {
            return;
          }
          if (action.kind === "share") {
            onShare(action.credential);
          } else if (action.kind === "revokeShare") {
            onRevokeShare(action.credential);
          } else {
            onRevokeCredential(action.credential);
          }
        }}
      />
    </section>
  );
}

function HarnessIcon({ agentKind }: { agentKind: AgentAuthAgentKind }) {
  return (
    <div className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border-light bg-foreground/5 text-foreground">
      {agentKind === "opencode"
        ? <Terminal className="size-4" />
        : <span className="text-sm font-semibold">{agentAuthAgentLabel(agentKind).slice(0, 1)}</span>}
    </div>
  );
}
