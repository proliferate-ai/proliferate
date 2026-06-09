import { useState } from "react";
import type { AgentAuthCredential, AgentGatewayCapabilities } from "@proliferate/cloud-sdk";
import { Button } from "@proliferate/ui/primitives/Button";
import { Badge } from "@proliferate/ui/primitives/Badge";
import { ConfirmationDialog } from "@proliferate/ui/primitives/ConfirmationDialog";
import { Plus } from "@proliferate/ui/icons";
import { SettingsCard } from "@/components/settings/shared/SettingsCard";
import {
  CloudAgentAuthCredentialForm,
  type CloudAgentAuthCredentialFormProps,
} from "@/components/settings/panes/agent-authentication/CloudAgentAuthCredentialForm";
import type { AgentAuthProvider, LocalAgentAuthSource } from "@/hooks/access/tauri/use-credentials-actions";
import {
  AGENT_AUTH_AGENT_ORDER,
  agentAuthAgentLabel,
} from "@/lib/domain/agent-auth/agent-auth-agent-presentation";
import {
  AGENT_AUTH_SLOT_DEFINITIONS,
  agentAuthCredentialProviderLabel,
  agentAuthSlotLabel,
  type AgentAuthSlotDefinition,
} from "@/lib/domain/agent-auth/auth-slots";
import { agentAuthManagedCreditsCapabilityLabel } from "@/lib/domain/agent-auth/agent-auth-gateway-capabilities";
import {
  agentAuthCredentialAvailability,
  agentAuthCredentialKindLabel,
  agentAuthCredentialOwnerLabel,
  agentAuthCredentialShareLabel,
  agentAuthCredentialStatusLabel,
  agentAuthCredentialStatusTone,
  credentialSummaryDetails,
  isProliferateManagedCreditsCredential,
} from "@/lib/domain/agent-auth/agent-auth-credential-presentation";

export function AuthenticationMethodsSection({
  capabilities,
  currentUserId,
  localSourcesByProvider,
  personalCredentials,
  rescanning,
  revokingCredentialId,
  revokingShareId,
  sharingCredentialId,
  ensuringFreeCredits,
  syncingLocalProvider,
  organizations,
  selectedOrganizationId,
  onSelectedOrganizationChange,
  onRescan,
  onRevokeCredential,
  onRevokeShare,
  onShareCredential,
  onEnsureFreeCredits,
  onSyncLocalCredential,
}: {
  capabilities: AgentGatewayCapabilities | null;
  currentUserId: string | null;
  localSourcesByProvider: Map<AgentAuthProvider, LocalAgentAuthSource>;
  personalCredentials: AgentAuthCredential[];
  rescanning: boolean;
  revokingCredentialId: string | null;
  revokingShareId: string | null;
  sharingCredentialId: string | null;
  ensuringFreeCredits: boolean;
  syncingLocalProvider: AgentAuthProvider | null;
  organizations: CloudAgentAuthCredentialFormProps["organizations"];
  selectedOrganizationId: string | null;
  onSelectedOrganizationChange: (organizationId: string | null) => void;
  onRescan: () => void;
  onRevokeCredential: (credential: AgentAuthCredential) => void;
  onRevokeShare: (credential: AgentAuthCredential) => void;
  onShareCredential: (credential: AgentAuthCredential) => void;
  onEnsureFreeCredits: () => void;
  onSyncLocalCredential: (provider: AgentAuthProvider) => void;
}) {
  const [credentialToRevoke, setCredentialToRevoke] = useState<AgentAuthCredential | null>(null);
  const [addingCredential, setAddingCredential] = useState(false);
  const managedCreditCredentials = personalCredentials.filter(isProliferateManagedCreditsCredential);
  const userManagedCredentials = personalCredentials.filter(
    (credential) => !isProliferateManagedCreditsCredential(credential),
  );
  return (
    <section className="space-y-3">
      <div className="space-y-1">
        <h2 className="text-sm font-medium text-foreground">Authentication methods</h2>
        <p className="max-w-2xl text-xs leading-4 text-muted-foreground">
          Detected local credentials, synced credentials, cloud API keys, BYOK,
          and managed credits available to your personal sandboxes.
        </p>
      </div>
      <SettingsCard>
        <div className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1.3fr)_11rem] gap-3 border-b border-border-light bg-foreground/5 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          <span>Method</span>
          <span>Provider</span>
          <span>Source</span>
          <span>Status</span>
        </div>
        {AGENT_AUTH_SLOT_DEFINITIONS.filter((slot) => slot.localProvider !== null)
          .map((slot) => {
          return (
            <LocalMethodRow
              key={`local-${slot.agentKind}-${slot.authSlotId}`}
              slot={slot}
              localSource={slot.localProvider
                ? localSourcesByProvider.get(slot.localProvider) ?? null
                : null}
              provider={slot.localProvider}
              rescanning={rescanning}
              syncingLocalProvider={syncingLocalProvider}
              onRescan={onRescan}
              onSyncLocalCredential={onSyncLocalCredential}
            />
          );
        })}
        <ManagedFreeCreditsMethodRow
          capabilities={capabilities}
          credentials={managedCreditCredentials}
          ensuring={ensuringFreeCredits}
          onEnsureFreeCredits={onEnsureFreeCredits}
        />
        {userManagedCredentials.length === 0 ? (
          <div className="border-t border-border-light px-4 py-3 text-xs text-muted-foreground">
            No synced or BYOK credentials have been saved yet.
          </div>
        ) : userManagedCredentials.map((credential) => (
          <CredentialMethodRow
            key={credential.id}
            capabilities={capabilities}
            credential={credential}
            currentUserId={currentUserId}
            revoking={revokingCredentialId === credential.id}
            revokingShare={credential.activeCredentialShareId === revokingShareId}
            sharing={sharingCredentialId === credential.id}
            onRequestRevoke={setCredentialToRevoke}
            onRevokeShare={onRevokeShare}
            onShareCredential={onShareCredential}
          />
        ))}
        <Button
          type="button"
          variant="unstyled"
          size="unstyled"
          className="flex w-full items-center justify-start gap-3 whitespace-normal px-4 py-3 text-left text-sm text-muted-foreground transition-colors hover:bg-list-hover hover:text-foreground"
          onClick={() => setAddingCredential((value) => !value)}
        >
          <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-md border border-border-light bg-foreground/5">
            <Plus className="size-3.5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-medium text-foreground">Add credential</span>
            <span className="block text-xs leading-4 text-muted-foreground">
              Add Anthropic, OpenAI, Gemini, or Bedrock credentials for a harness.
            </span>
          </span>
          <span className="text-xs text-muted-foreground">
            {addingCredential ? "Close" : "Add"}
          </span>
        </Button>
      </SettingsCard>
      {addingCredential && (
        <CloudAgentAuthCredentialForm
          organizations={organizations}
          selectedOrganizationId={selectedOrganizationId}
          onSelectedOrganizationChange={onSelectedOrganizationChange}
          agentGatewayCapabilities={capabilities}
          allowedOwnerScopes={["personal"]}
        />
      )}
      <ConfirmationDialog
        open={credentialToRevoke !== null}
        title="Delete credential?"
        description={credentialToRevoke
          ? `${credentialToRevoke.displayName} will be removed from your personal cloud credential library.`
          : ""}
        confirmLabel="Delete credential"
        confirmVariant="destructive"
        onClose={() => setCredentialToRevoke(null)}
        onConfirm={() => {
          const credential = credentialToRevoke;
          setCredentialToRevoke(null);
          if (credential) {
            onRevokeCredential(credential);
          }
        }}
      />
    </section>
  );
}

function ManagedFreeCreditsMethodRow({
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
        <div className="mt-0.5 truncate text-xs text-muted-foreground">
          Managed gateway credit
        </div>
      </div>
      <div className="min-w-0 text-xs text-muted-foreground">
        {harnessLabel}
      </div>
      <div className="min-w-0 truncate text-xs text-muted-foreground">
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

function LocalMethodRow({
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
      <div className="min-w-0 text-xs text-muted-foreground">
        {agentAuthSlotLabel(slot)}
      </div>
      <div className="min-w-0 truncate text-xs text-muted-foreground">
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

function CredentialMethodRow({
  capabilities,
  credential,
  currentUserId,
  revoking,
  revokingShare,
  sharing,
  onRequestRevoke,
  onRevokeShare,
  onShareCredential,
}: {
  capabilities: AgentGatewayCapabilities | null;
  credential: AgentAuthCredential;
  currentUserId: string | null;
  revoking: boolean;
  revokingShare: boolean;
  sharing: boolean;
  onRequestRevoke: (credential: AgentAuthCredential) => void;
  onRevokeShare: (credential: AgentAuthCredential) => void;
  onShareCredential: (credential: AgentAuthCredential) => void;
}) {
  const availability = agentAuthCredentialAvailability(credential, capabilities);
  const shareLabel = agentAuthCredentialShareLabel(credential, currentUserId);
  const canManageShare = shareLabel !== null
    && credential.ownerScope === "personal"
    && credential.ownerUserId === currentUserId;
  const canRevokeCredential = credential.ownerScope === "personal"
    && credential.ownerUserId === currentUserId
    && !isProliferateManagedCreditsCredential(credential);
  return (
    <div className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1.3fr)_11rem] items-center gap-3 border-b border-border-light px-4 py-3 last:border-b-0">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-foreground">
          {credential.displayName}
        </div>
        <div className="mt-0.5 truncate text-xs text-muted-foreground">
          {agentAuthCredentialKindLabel(credential)}
        </div>
      </div>
      <div className="min-w-0 text-xs text-muted-foreground">
        {agentAuthCredentialProviderLabel(credential.credentialProviderId)}
      </div>
      <div className="min-w-0 truncate text-xs text-muted-foreground">
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
        {canManageShare && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            loading={credential.activeCredentialShareId ? revokingShare : sharing}
            onClick={() => {
              if (credential.activeCredentialShareId) {
                onRevokeShare(credential);
                return;
              }
              onShareCredential(credential);
            }}
          >
            {credential.activeCredentialShareId ? "Unshare" : "Share"}
          </Button>
        )}
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
