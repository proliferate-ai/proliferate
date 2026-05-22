import type {
  AgentAuthAgentKind,
  AgentAuthCredential,
  AgentGatewayCapabilities,
} from "@proliferate/cloud-sdk";
import { Button } from "@proliferate/ui/primitives/Button";
import { Badge } from "@/components/ui/Badge";
import {
  ChevronDown,
  CloudIcon,
  RefreshCw,
  Terminal,
} from "@/components/ui/icons";
import type { LocalAgentAuthSource } from "@/hooks/access/tauri/use-credentials-actions";
import { agentAuthenticationCopy } from "@/copy/settings/agent-authentication-copy";
import {
  agentAuthAgentLabel,
  agentAuthCredentialAvailability,
  agentAuthCredentialKindLabel,
  agentAuthCredentialOwnerLabel,
  agentAuthCredentialSection,
  agentAuthCredentialSectionLabel,
  agentAuthCredentialShareLabel,
  agentAuthCredentialStatusLabel,
  agentAuthCredentialStatusTone,
  describeAgentAuthCredential,
  isProliferateManagedCreditsCredential,
} from "@/lib/domain/agent-auth/agent-auth-presentation";

interface AgentAuthCredentialFooterProps {
  agentKind: AgentAuthAgentKind;
  credentials: AgentAuthCredential[];
  localSource: LocalAgentAuthSource | null;
  capabilities: AgentGatewayCapabilities | null;
  currentUserId: string | null;
  adminOrganizationIds: ReadonlySet<string>;
  libraryOrganizationId: string | null;
  detectedCount: number;
  rescanning: boolean;
  sharingCredentialId: string | null;
  revokingShareId: string | null;
  revokingCredentialId: string | null;
  onRescan: () => void;
  onShare: (credential: AgentAuthCredential) => void;
  onRevokeShare: (credential: AgentAuthCredential) => void;
  onRevokeCredential: (credential: AgentAuthCredential) => void;
}

export function AgentAuthCredentialFooter({
  agentKind,
  credentials,
  localSource,
  capabilities,
  currentUserId,
  adminOrganizationIds,
  libraryOrganizationId,
  detectedCount,
  rescanning,
  sharingCredentialId,
  revokingShareId,
  revokingCredentialId,
  onRescan,
  onShare,
  onRevokeShare,
  onRevokeCredential,
}: AgentAuthCredentialFooterProps) {
  return (
    <details className="border-t border-border-light" open={agentKind === "claude"}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 marker:hidden">
        <div className="flex min-w-0 items-center gap-2">
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <div className="text-xs font-medium text-foreground">
              {agentAuthenticationCopy.detectedCredentialsTitle}
            </div>
            <div className="text-xs text-muted-foreground">
              {detectedCount} available for {agentAuthAgentLabel(agentKind)}
            </div>
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          loading={rescanning}
          onClick={(event) => {
            event.preventDefault();
            onRescan();
          }}
        >
          <RefreshCw className="size-3.5" />
          Re-scan
        </Button>
      </summary>
      <div className="divide-y divide-border-light border-t border-border-light">
        {localSource && (
          <LocalCredentialRow localSource={localSource} />
        )}
        {credentials.length === 0 && !localSource ? (
          <div className="px-4 py-3 text-xs text-muted-foreground">
            {agentAuthenticationCopy.noCredentials}
          </div>
        ) : credentials.map((credential) => (
          <CredentialRow
            key={credential.id}
            credential={credential}
            capabilities={capabilities}
            currentUserId={currentUserId}
            adminOrganizationIds={adminOrganizationIds}
            sharingEnabled={Boolean(libraryOrganizationId)}
            sharingCredentialId={sharingCredentialId}
            revokingShareId={revokingShareId}
            revokingCredentialId={revokingCredentialId}
            onShare={onShare}
            onRevokeShare={onRevokeShare}
            onRevokeCredential={onRevokeCredential}
          />
        ))}
      </div>
    </details>
  );
}

function LocalCredentialRow({ localSource }: { localSource: LocalAgentAuthSource }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <CredentialIcon kind={localSource.authMode === "env" ? "env" : "file"} />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
            Local {agentAuthAgentLabel(localSource.provider)} auth
            <Badge>{localSource.authMode === "env" ? "Env" : "File"}</Badge>
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {localSource.detected ? "Detected on this Mac" : "No local source detected"}
          </div>
        </div>
      </div>
      <Badge tone={localSource.detected ? "success" : "neutral"}>
        {localSource.detected ? "Detected" : "Missing"}
      </Badge>
    </div>
  );
}

function CredentialRow({
  credential,
  capabilities,
  currentUserId,
  adminOrganizationIds,
  sharingEnabled,
  sharingCredentialId,
  revokingShareId,
  revokingCredentialId,
  onShare,
  onRevokeShare,
  onRevokeCredential,
}: {
  credential: AgentAuthCredential;
  capabilities: AgentGatewayCapabilities | null;
  currentUserId: string | null;
  adminOrganizationIds: ReadonlySet<string>;
  sharingEnabled: boolean;
  sharingCredentialId: string | null;
  revokingShareId: string | null;
  revokingCredentialId: string | null;
  onShare: (credential: AgentAuthCredential) => void;
  onRevokeShare: (credential: AgentAuthCredential) => void;
  onRevokeCredential: (credential: AgentAuthCredential) => void;
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
  const canManageCredential = canManageAuthCredential(
    credential,
    currentUserId,
    adminOrganizationIds,
  ) && !isProliferateManagedCreditsCredential(credential);
  const section = agentAuthCredentialSection(credential);
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <CredentialIcon kind={credential.credentialKind === "synced_path" ? "file" : "cloud"} />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
            <span className="truncate">{credential.displayName}</span>
            <Badge>{agentAuthCredentialSectionLabel(section)}</Badge>
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {agentAuthCredentialKindLabel(credential)} - {describeAgentAuthCredential(credential)}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>{agentAuthCredentialOwnerLabel(credential)}</span>
            {shareLabel && <span>{shareLabel}</span>}
            {availability.reason && <span>{availability.reason}</span>}
          </div>
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
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
            disabled={!sharingEnabled}
            loading={sharingCredentialId === credential.id}
            onClick={() => onShare(credential)}
          >
            Share
          </Button>
        )}
        {canRevokeShare && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            loading={revokingShareId === credential.activeCredentialShareId}
            onClick={() => onRevokeShare(credential)}
          >
            Revoke share
          </Button>
        )}
        {canManageCredential && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            loading={revokingCredentialId === credential.id}
            onClick={() => onRevokeCredential(credential)}
          >
            Revoke
          </Button>
        )}
      </div>
    </div>
  );
}

function CredentialIcon({ kind }: { kind: "cloud" | "env" | "file" }) {
  return (
    <div className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border-light bg-foreground/5 text-muted-foreground">
      {kind === "cloud" ? <CloudIcon className="size-4" /> : <Terminal className="size-4" />}
    </div>
  );
}

function canManageAuthCredential(
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
