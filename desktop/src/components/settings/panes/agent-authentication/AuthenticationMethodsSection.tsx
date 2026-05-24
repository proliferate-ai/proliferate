import { useState } from "react";
import type { AgentAuthAgentKind, AgentAuthCredential, AgentGatewayCapabilities } from "@proliferate/cloud-sdk";
import { Button } from "@proliferate/ui/primitives/Button";
import { Badge } from "@/components/ui/Badge";
import { ConfirmationDialog } from "@/components/ui/ConfirmationDialog";
import { Plus } from "@/components/ui/icons";
import { SettingsCard } from "@/components/settings/shared/SettingsCard";
import {
  CloudAgentAuthCredentialForm,
  type CloudAgentAuthCredentialFormProps,
} from "@/components/settings/panes/agent-authentication/CloudAgentAuthCredentialForm";
import type { AgentAuthProvider, LocalAgentAuthSource } from "@/hooks/access/tauri/use-credentials-actions";
import {
  AGENT_AUTH_AGENT_ORDER,
  agentAuthAgentLabel,
  agentAuthCredentialAvailability,
  agentAuthCredentialKindLabel,
  agentAuthCredentialOwnerLabel,
  agentAuthCredentialStatusLabel,
  agentAuthCredentialStatusTone,
  credentialSummaryDetails,
  isProliferateManagedCreditsCredential,
} from "@/lib/domain/agent-auth/agent-auth-presentation";

export function AuthenticationMethodsSection({
  capabilities,
  currentUserId,
  localSourcesByProvider,
  personalCredentials,
  rescanning,
  revokingCredentialId,
  syncingLocalProvider,
  organizations,
  selectedOrganizationId,
  onSelectedOrganizationChange,
  onRescan,
  onRevokeCredential,
  onSyncLocalCredential,
}: {
  capabilities: AgentGatewayCapabilities | null;
  currentUserId: string | null;
  localSourcesByProvider: Map<AgentAuthProvider, LocalAgentAuthSource>;
  personalCredentials: AgentAuthCredential[];
  rescanning: boolean;
  revokingCredentialId: string | null;
  syncingLocalProvider: AgentAuthProvider | null;
  organizations: CloudAgentAuthCredentialFormProps["organizations"];
  selectedOrganizationId: string | null;
  onSelectedOrganizationChange: (organizationId: string | null) => void;
  onRescan: () => void;
  onRevokeCredential: (credential: AgentAuthCredential) => void;
  onSyncLocalCredential: (provider: AgentAuthProvider) => void;
}) {
  const [credentialToRevoke, setCredentialToRevoke] = useState<AgentAuthCredential | null>(null);
  const [addingCredential, setAddingCredential] = useState(false);
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
        <div className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1.3fr)_8rem] gap-3 border-b border-border-light bg-foreground/5 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          <span>Method</span>
          <span>Harness</span>
          <span>Source</span>
          <span>Status</span>
        </div>
        {AGENT_AUTH_AGENT_ORDER.map((agentKind) => {
          const provider = providerForAgentKind(agentKind);
          return (
            <LocalMethodRow
              key={`local-${agentKind}`}
              agentKind={agentKind}
              localSource={provider ? localSourcesByProvider.get(provider) ?? null : null}
              provider={provider}
              rescanning={rescanning}
              syncingLocalProvider={syncingLocalProvider}
              onRescan={onRescan}
              onSyncLocalCredential={onSyncLocalCredential}
            />
          );
        })}
        {personalCredentials.length === 0 ? (
          <div className="border-t border-border-light px-4 py-3 text-xs text-muted-foreground">
            No synced or cloud credentials have been saved yet.
          </div>
        ) : personalCredentials.map((credential) => (
          <CredentialMethodRow
            key={credential.id}
            capabilities={capabilities}
            credential={credential}
            currentUserId={currentUserId}
            revoking={revokingCredentialId === credential.id}
            onRequestRevoke={setCredentialToRevoke}
          />
        ))}
        <button
          type="button"
          className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-muted-foreground transition-colors hover:bg-list-hover hover:text-foreground"
          onClick={() => setAddingCredential((value) => !value)}
        >
          <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-md border border-border-light bg-foreground/5">
            <Plus className="size-3.5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-medium text-foreground">Add credential</span>
            <span className="block text-xs leading-4 text-muted-foreground">
              Add an API key, OpenAI-compatible gateway, or Bedrock role for a harness.
            </span>
          </span>
          <span className="text-xs text-muted-foreground">
            {addingCredential ? "Close" : "Add"}
          </span>
        </button>
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

function LocalMethodRow({
  agentKind,
  localSource,
  provider,
  rescanning,
  syncingLocalProvider,
  onRescan,
  onSyncLocalCredential,
}: {
  agentKind: AgentAuthAgentKind;
  localSource: LocalAgentAuthSource | null;
  provider: AgentAuthProvider | null;
  rescanning: boolean;
  syncingLocalProvider: AgentAuthProvider | null;
  onRescan: () => void;
  onSyncLocalCredential: (provider: AgentAuthProvider) => void;
}) {
  const detected = localSource?.detected === true;
  return (
    <div className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1.3fr)_8rem] items-center gap-3 border-b border-border-light px-4 py-3">
      <div className="min-w-0 text-sm font-medium text-foreground">Local credential</div>
      <div className="min-w-0 text-xs text-muted-foreground">
        {agentAuthAgentLabel(agentKind)}
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
    <div className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1.3fr)_8rem] items-center gap-3 border-b border-border-light px-4 py-3 last:border-b-0">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-foreground">
          {credential.displayName}
        </div>
        <div className="mt-0.5 truncate text-xs text-muted-foreground">
          {agentAuthCredentialKindLabel(credential)}
        </div>
      </div>
      <div className="min-w-0 text-xs text-muted-foreground">
        {agentAuthAgentLabel(credential.agentKind)}
      </div>
      <div className="min-w-0 truncate text-xs text-muted-foreground">
        {methodSourceLabel(credential)}
      </div>
      <div className="flex items-center justify-end gap-2">
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

function providerForAgentKind(agentKind: AgentAuthAgentKind): AgentAuthProvider | null {
  if (agentKind === "claude" || agentKind === "codex" || agentKind === "gemini") {
    return agentKind;
  }
  return null;
}
