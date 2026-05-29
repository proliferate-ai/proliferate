import { useState } from "react";
import type {
  AgentAuthAgentKind,
  AgentAuthCredential,
  AgentGatewayCapabilities,
} from "@proliferate/cloud-sdk";
import { Button } from "@proliferate/ui/primitives/Button";
import { Badge } from "@/components/ui/Badge";
import { ConfirmationDialog } from "@/components/ui/ConfirmationDialog";
import { SettingsCard } from "@/components/settings/shared/SettingsCard";
import { SettingsCardRow } from "@/components/settings/shared/SettingsCardRow";
import {
  CloudIcon,
  CloudUpload,
  RefreshCw,
  Terminal,
} from "@/components/ui/icons";
import type {
  AgentAuthProvider,
  LocalAgentAuthSource,
} from "@/hooks/access/tauri/use-credentials-actions";
import { agentAuthenticationCopy } from "@/copy/settings/agent-authentication-copy";
import {
  agentAuthAgentLabel,
  agentAuthCredentialAvailability,
  agentAuthCredentialKindLabel,
  agentAuthCredentialShareLabel,
  agentAuthCredentialStatusLabel,
  agentAuthCredentialStatusTone,
  agentAuthHarnessDescription,
  credentialSummaryDetails,
  isProliferateManagedCreditsCredential,
} from "@/lib/domain/agent-auth/agent-auth-presentation";

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

function PersonalCredentialRow({
  credential,
  capabilities,
  currentUserId,
  selectedOrganizationName,
  sharingCredentialId,
  revokingShareId,
  revokingCredentialId,
  onRequestAction,
}: {
  credential: AgentAuthCredential;
  capabilities: AgentGatewayCapabilities | null;
  currentUserId: string | null;
  selectedOrganizationName: string | null;
  sharingCredentialId: string | null;
  revokingShareId: string | null;
  revokingCredentialId: string | null;
  onRequestAction: (action: PersonalCredentialConfirmationAction) => void;
}) {
  const availability = agentAuthCredentialAvailability(credential, capabilities);
  const shareLabel = agentAuthCredentialShareLabel(credential, currentUserId);
  const canShare = credential.ownerScope === "personal"
    && credential.credentialKind === "synced_path"
    && credential.ownerUserId === currentUserId
    && !credential.activeCredentialShareId;
  const canRevokeShare = credential.ownerScope === "personal"
    && credential.credentialKind === "synced_path"
    && credential.ownerUserId === currentUserId
    && Boolean(credential.activeCredentialShareId);
  const canRevokeCredential = credential.ownerScope === "personal"
    && credential.ownerUserId === currentUserId
    && !isProliferateManagedCreditsCredential(credential);
  return (
    <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <CredentialIcon cloud={credential.credentialKind === "managed_gateway"} />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
            <span className="truncate">{credential.displayName}</span>
            <Badge>{agentAuthCredentialKindLabel(credential)}</Badge>
          </div>
          <div className="mt-1 truncate text-xs text-muted-foreground">
            {credentialSummaryDetails(credential) || "Synced auth file"}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {shareLabel && <span>{shareLabel}</span>}
            {availability.reason && <span>{availability.reason}</span>}
          </div>
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
        <Badge tone={availability.status === "available"
          ? agentAuthCredentialStatusTone(credential.status)
          : "neutral"}
        >
          {availability.status === "available"
            ? agentAuthCredentialStatusLabel(credential.status)
            : availability.label}
        </Badge>
        {canShare && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!selectedOrganizationName}
            loading={sharingCredentialId === credential.id}
            onClick={() => onRequestAction({ kind: "share", credential })}
          >
            {selectedOrganizationName ? "Allow team admins" : "Select team"}
          </Button>
        )}
        {canRevokeShare && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            loading={revokingShareId === credential.activeCredentialShareId}
            onClick={() => onRequestAction({ kind: "revokeShare", credential })}
          >
            Stop team use
          </Button>
        )}
        {canRevokeCredential && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            loading={revokingCredentialId === credential.id}
            onClick={() => onRequestAction({ kind: "deleteCredential", credential })}
          >
            Delete cloud copy
          </Button>
        )}
      </div>
    </div>
  );
}

function localAuthDescription(
  agentKind: AgentAuthAgentKind,
  localSource: LocalAgentAuthSource | null,
  localSourceError: string | null,
) {
  if (localSourceError) {
    return "Desktop could not scan local credentials. Re-scan after the local auth files or environment are available.";
  }
  if (!localSource) {
    return agentKind === "opencode"
      ? "OpenCode local auth is session-only in Desktop V1. Shared cloud should use a team default when available."
      : "Desktop cannot sync this harness yet.";
  }
  if (!localSource.detected) {
    return "No local credential was detected on this Mac. Sign in locally, then re-scan.";
  }
  return localSource.authMode === "env"
    ? "Detected from local environment configuration. Syncing stores a cloud copy for personal cloud runs."
    : "Detected from the harness auth files on this Mac. Syncing stores a cloud copy for personal cloud runs.";
}

type PersonalCredentialConfirmationAction =
  | { kind: "share"; credential: AgentAuthCredential }
  | { kind: "revokeShare"; credential: AgentAuthCredential }
  | { kind: "deleteCredential"; credential: AgentAuthCredential };

function localAuthBadge(
  localSource: LocalAgentAuthSource | null,
  localSourceError: string | null,
) {
  if (localSourceError) {
    return { label: "Scan failed", tone: "warning" as const };
  }
  if (!localSource) {
    return { label: "Unsupported", tone: "neutral" as const };
  }
  return localSource.detected
    ? { label: "Detected", tone: "success" as const }
    : { label: "Missing", tone: "neutral" as const };
}

function cloudCredentialDescription(
  credentials: AgentAuthCredential[],
  credentialsLoading: boolean,
) {
  if (credentialsLoading) {
    return "Loading cloud credentials...";
  }
  return credentials.length > 0
    ? "Credentials synced from this Mac or added as personal gateway credentials."
    : agentAuthenticationCopy.noCloudCredentials;
}

function confirmationTitle(action: PersonalCredentialConfirmationAction | null): string {
  if (!action) {
    return "";
  }
  if (action.kind === "share") {
    return "Allow team admins to use this credential?";
  }
  if (action.kind === "revokeShare") {
    return "Stop team use?";
  }
  return "Delete this cloud credential?";
}

function confirmationDescription(
  action: PersonalCredentialConfirmationAction | null,
  selectedOrganizationName: string | null,
): string {
  if (!action) {
    return "";
  }
  if (action.kind === "share") {
    return `${action.credential.displayName} will be visible to admins for ${selectedOrganizationName ?? "the selected team"} shared cloud defaults.`;
  }
  if (action.kind === "revokeShare") {
    return `${action.credential.displayName} will no longer be available for shared cloud defaults. Existing runs may need their agent auth refreshed.`;
  }
  return `${action.credential.displayName} will be removed from Cloud. Local auth files on this Mac are not deleted.`;
}

function confirmationConfirmLabel(action: PersonalCredentialConfirmationAction | null): string {
  if (!action) {
    return "";
  }
  if (action.kind === "share") {
    return "Allow team admins";
  }
  if (action.kind === "revokeShare") {
    return "Stop team use";
  }
  return "Delete cloud copy";
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

function CredentialIcon({ cloud }: { cloud: boolean }) {
  return (
    <div className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border-light bg-foreground/5 text-muted-foreground">
      {cloud ? <CloudIcon className="size-4" /> : <CloudUpload className="size-4" />}
    </div>
  );
}
