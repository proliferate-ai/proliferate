import type { AgentAuthCredential, AgentGatewayCapabilities } from "@proliferate/cloud-sdk";
import { Button } from "@proliferate/ui/primitives/Button";
import { Badge } from "@proliferate/ui/primitives/Badge";
import type {
  AgentAuthProvider,
  LocalAgentAuthSource,
} from "@/hooks/access/tauri/use-credentials-actions";
import {
  AGENT_AUTH_AGENT_ORDER,
  agentAuthAgentLabel,
} from "@/lib/domain/agent-auth/agent-auth-agent-presentation";
import { agentAuthManagedCreditsCapabilityLabel } from "@/lib/domain/agent-auth/agent-auth-gateway-capabilities";
import {
  agentAuthCredentialAvailability,
  agentAuthCredentialKindLabel,
  agentAuthCredentialOwnerLabel,
  agentAuthCredentialStatusLabel,
  agentAuthCredentialStatusTone,
  credentialSummaryDetails,
  isProliferateManagedCreditsCredential,
} from "@/lib/domain/agent-auth/agent-auth-credential-presentation";
import {
  agentAuthCredentialProviderLabel,
  agentAuthSlotLabel,
  type AgentAuthSlotDefinition,
} from "@/lib/domain/agent-auth/auth-slots";

export function ManagedFreeCreditsMethodRow({
  capabilities,
  credentials,
  ensuring,
  onEnsureFreeCredits,
}: {
  capabilities: AgentGatewayCapabilities | null;
  credentials: AgentAuthCredential[];
  ensuring: boolean;
  onEnsureFreeCredits: () => void;
}) {
  const enabled = capabilities?.enabled === true && capabilities.managedCreditsPersonalEnabled;
  const harnessLabel = managedCreditHarnessLabel(capabilities, credentials);
  const ready = credentials.length > 0;
  const statusLabel = !capabilities
    ? "Checking"
    : ready ? "Ready" : enabled ? "Available" : "Unavailable";
  const statusTone = ready ? "success" : "neutral";
  return (
    <div className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1.3fr)_11rem] items-center gap-3 border-b border-border-light px-4 py-3">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-foreground">
          Proliferate Default Free credits
        </div>
        <div className="mt-0.5 truncate text-sm text-muted-foreground">
          Managed gateway credit
        </div>
      </div>
      <div className="min-w-0 text-sm text-muted-foreground">
        {harnessLabel}
      </div>
      <div className="min-w-0 truncate text-sm text-muted-foreground">
        {agentAuthManagedCreditsCapabilityLabel(capabilities, "personal")}
      </div>
      <div className="flex items-center justify-end gap-2">
        <Badge tone={statusTone}>{statusLabel}</Badge>
        {enabled && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            loading={ensuring}
            onClick={() => onEnsureFreeCredits()}
          >
            {ready ? "Refresh" : "Enable"}
          </Button>
        )}
      </div>
    </div>
  );
}

export function LocalMethodRow({
  slot,
  localSource,
  provider,
  rescanning,
  syncingLocalProvider,
  onRescan,
  onSyncLocalCredential,
}: {
  slot: AgentAuthSlotDefinition;
  localSource: LocalAgentAuthSource | null;
  provider: AgentAuthProvider | null;
  rescanning: boolean;
  syncingLocalProvider: AgentAuthProvider | null;
  onRescan: () => void;
  onSyncLocalCredential: (provider: AgentAuthProvider) => void;
}) {
  const detected = localSource?.detected === true;
  return (
    <div className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1.3fr)_11rem] items-center gap-3 border-b border-border-light px-4 py-3">
      <div className="min-w-0 text-sm font-medium text-foreground">Local credential</div>
      <div className="min-w-0 text-sm text-muted-foreground">
        {agentAuthSlotLabel(slot)}
      </div>
      <div className="min-w-0 truncate text-sm text-muted-foreground">
        {provider
          ? detected
            ? `${localSource.authMode} credential detected`
            : "No local credential detected"
          : "No local sync source"}
      </div>
      <div className="flex items-center justify-end gap-2">
        <Badge tone={detected ? "success" : "neutral"}>
          {provider ? detected ? "Detected" : "Missing" : "Unsupported"}
        </Badge>
        {provider && detected ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            loading={syncingLocalProvider === provider}
            onClick={() => onSyncLocalCredential(provider)}
          >
            Sync
          </Button>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            loading={rescanning}
            disabled={!provider}
            onClick={() => onRescan()}
          >
            Scan
          </Button>
        )}
      </div>
    </div>
  );
}

export function CredentialMethodRow({
  capabilities,
  credential,
  currentUserId,
  revoking,
  onRequestRevoke,
}: {
  capabilities: AgentGatewayCapabilities | null;
  credential: AgentAuthCredential;
  currentUserId: string | null;
  revoking: boolean;
  onRequestRevoke: (credential: AgentAuthCredential) => void;
}) {
  const availability = agentAuthCredentialAvailability(credential, capabilities);
  const canRevokeCredential = credential.ownerScope === "personal"
    && credential.ownerUserId === currentUserId
    && !isProliferateManagedCreditsCredential(credential);
  return (
    <div className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1.3fr)_11rem] items-center gap-3 border-b border-border-light px-4 py-3 last:border-b-0">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-foreground">
          {credential.displayName}
        </div>
        <div className="mt-0.5 truncate text-sm text-muted-foreground">
          {agentAuthCredentialKindLabel(credential)}
        </div>
      </div>
      <div className="min-w-0 text-sm text-muted-foreground">
        {agentAuthCredentialProviderLabel(credential.credentialProviderId)}
      </div>
      <div className="min-w-0 truncate text-sm text-muted-foreground">
        {methodSourceLabel(credential)}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Badge tone={availability.status === "available"
          ? agentAuthCredentialStatusTone(credential.status)
          : "neutral"}
        >
          {availability.status === "available"
            ? agentAuthCredentialStatusLabel(credential.status)
            : availability.label}
        </Badge>
        {canRevokeCredential && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            loading={revoking}
            onClick={() => onRequestRevoke(credential)}
          >
            Delete
          </Button>
        )}
      </div>
    </div>
  );
}

function methodSourceLabel(credential: AgentAuthCredential): string {
  if (credential.credentialKind === "synced_path") {
    return "Synced from desktop";
  }
  if (isProliferateManagedCreditsCredential(credential)) {
    return "Managed credits";
  }
  const details = credentialSummaryDetails(credential);
  return details
    ? `${agentAuthCredentialOwnerLabel(credential)} · ${details}`
    : agentAuthCredentialOwnerLabel(credential);
}

function managedCreditHarnessLabel(
  capabilities: AgentGatewayCapabilities | null,
  credentials: AgentAuthCredential[],
): string {
  const configuredAgentKinds = capabilities?.managedCreditAgentKinds ?? [];
  const agentKinds = AGENT_AUTH_AGENT_ORDER.filter((agentKind) =>
    configuredAgentKinds.includes(agentKind));
  if (agentKinds.length === 0) {
    return credentials.length > 0 ? "Available providers" : "Configured harnesses";
  }
  return agentKinds.map(agentAuthAgentLabel).join(", ");
}
