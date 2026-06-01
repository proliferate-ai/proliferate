import type {
  AgentAuthCredential,
  AgentGatewayCapabilities,
} from "@proliferate/cloud-sdk";
import { Button } from "@proliferate/ui/primitives/Button";
import { Badge } from "@proliferate/ui/primitives/Badge";
import { CloudIcon, CloudUpload } from "@proliferate/ui/icons";
import {
  agentAuthCredentialAvailability,
  agentAuthCredentialKindLabel,
  agentAuthCredentialShareLabel,
  agentAuthCredentialStatusLabel,
  agentAuthCredentialStatusTone,
  credentialSummaryDetails,
  isProliferateManagedCreditsCredential,
} from "@/lib/domain/agent-auth/agent-auth-credential-presentation";
import type { PersonalCredentialConfirmationAction } from "@/lib/domain/agent-auth/personal-credential-presentation";

export function PersonalCredentialRow({
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

function CredentialIcon({ cloud }: { cloud: boolean }) {
  return (
    <div className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border-light bg-foreground/5 text-muted-foreground">
      {cloud ? <CloudIcon className="size-4" /> : <CloudUpload className="size-4" />}
    </div>
  );
}
