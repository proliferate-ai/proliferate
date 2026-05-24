import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type {
  AgentAuthAgentKind,
  AgentAuthCredential,
  AgentGatewayCapabilities,
  SandboxAgentAuthSelection,
} from "@proliferate/cloud-sdk";
import { Button } from "@proliferate/ui/primitives/Button";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { ConfirmationDialog } from "@/components/ui/ConfirmationDialog";
import { SettingsMenu } from "@/components/ui/SettingsMenu";
import { Plus, RefreshCw } from "@/components/ui/icons";
import { ProviderIcon } from "@/components/ui/provider-icons";
import { SettingsCard } from "@/components/settings/shared/SettingsCard";
import { SettingsCardRow } from "@/components/settings/shared/SettingsCardRow";
import {
  CloudAgentAuthCredentialForm,
  type CloudAgentAuthCredentialFormProps,
} from "@/components/settings/panes/agent-authentication/CloudAgentAuthCredentialForm";
import { useAgentAuthLibraryActions } from "@/hooks/settings/workflows/use-agent-auth-library-actions";
import type {
  AgentAuthProvider,
  LocalAgentAuthSource,
} from "@/hooks/access/tauri/use-credentials-actions";
import {
  AGENT_AUTH_AGENT_ORDER,
  agentAuthAgentLabel,
  agentAuthCredentialAvailability,
  agentAuthCredentialKindLabel,
  agentAuthCredentialOwnerLabel,
  agentAuthCredentialStatusLabel,
  agentAuthCredentialStatusTone,
  agentAuthHarnessDescription,
  credentialSelectableReason,
  credentialSummaryDetails,
  isProliferateManagedCreditsCredential,
  selectionByAgentKind,
} from "@/lib/domain/agent-auth/agent-auth-presentation";
import { buildSettingsHref } from "@/lib/domain/settings/navigation";

interface CloudAgentAuthLibraryProps {
  initialAgentKind?: AgentAuthAgentKind | null;
}

export function CloudAgentAuthLibrary({ initialAgentKind = null }: CloudAgentAuthLibraryProps) {
  const library = useAgentAuthLibraryActions(initialAgentKind);
  const navigate = useNavigate();
  const credentialLoadError = library.personalCredentialsError;
  const personalCredentials = useMemo(
    () => [...library.personalCredentialsByAgent.values()].flat(),
    [library.personalCredentialsByAgent],
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
        credentialsByAgent={library.personalCredentialsByAgent}
        credentialsLoading={library.personalCredentialsLoading}
        localSourceError={library.localSourceError}
        localSourcesByProvider={library.localSourcesByProvider}
        personalSelections={library.personalSelections}
        rescanning={library.rescanning}
        selecting={library.selectingTeamDefault}
        syncingLocalProvider={library.syncingLocalProvider}
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
        syncingLocalProvider={library.syncingLocalProvider}
        organizations={library.organizationOptions}
        selectedOrganizationId={library.selectedOrganizationId}
        onSelectedOrganizationChange={library.setSelectedOrganizationId}
        onRescan={library.handleRescan}
        onRevokeCredential={library.handleRevokeCredential}
        onSyncLocalCredential={library.handleSyncLocalCredential}
      />
    </div>
  );
}

function PersonalAuthInUseSection({
  capabilities,
  credentialsByAgent,
  credentialsLoading,
  localSourceError,
  localSourcesByProvider,
  personalSelections,
  rescanning,
  selecting,
  syncingLocalProvider,
  onEnsurePersonalProfile,
  onRescan,
  onSelectPersonalDefault,
  onSyncLocalCredential,
}: {
  capabilities: AgentGatewayCapabilities | null;
  credentialsByAgent: Map<string, AgentAuthCredential[]>;
  credentialsLoading: boolean;
  localSourceError: string | null;
  localSourcesByProvider: Map<AgentAuthProvider, LocalAgentAuthSource>;
  personalSelections: SandboxAgentAuthSelection[];
  rescanning: boolean;
  selecting: boolean;
  syncingLocalProvider: AgentAuthProvider | null;
  onEnsurePersonalProfile: () => void;
  onRescan: () => void;
  onSelectPersonalDefault: (agentKind: AgentAuthAgentKind, credentialId: string) => void;
  onSyncLocalCredential: (provider: AgentAuthProvider) => void;
}) {
  const selectionsByAgent = selectionByAgentKind(personalSelections);
  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-sm font-medium text-foreground">In use</h2>
          <p className="max-w-2xl text-xs leading-4 text-muted-foreground">
            Pick the credential each harness uses in local and personal cloud sandboxes.
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

      <SettingsCard>
        <div className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.1fr)] gap-3 border-b border-border-light bg-foreground/5 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          <span>Harness</span>
          <span>Local sandbox</span>
          <span>Personal cloud</span>
        </div>
        {AGENT_AUTH_AGENT_ORDER.map((agentKind) => {
          const provider = providerForAgentKind(agentKind);
          return (
            <div
              key={agentKind}
              id={`agent-auth-${agentKind}`}
              className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.1fr)] items-center gap-3 border-b border-border-light px-4 py-3 last:border-b-0"
            >
              <HarnessIdentity agentKind={agentKind} />
              <LocalAuthCell
                agentKind={agentKind}
                localSource={provider
                  ? localSourcesByProvider.get(provider) ?? null
                  : null}
                localSourceError={localSourceError}
                provider={provider}
                syncingLocalProvider={syncingLocalProvider}
                onSyncLocalCredential={onSyncLocalCredential}
              />
              <PersonalCloudAuthCell
                agentKind={agentKind}
                capabilities={capabilities}
                credentials={credentialsByAgent.get(agentKind) ?? []}
                credentialsLoading={credentialsLoading}
                selecting={selecting}
                selection={selectionsByAgent.get(agentKind)}
                onEnsurePersonalProfile={onEnsurePersonalProfile}
                onSelectPersonalDefault={onSelectPersonalDefault}
              />
            </div>
          );
        })}
      </SettingsCard>
    </section>
  );
}

function HarnessIdentity({ agentKind }: { agentKind: AgentAuthAgentKind }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-border-light bg-foreground/5 text-foreground">
        <ProviderIcon kind={agentKind} className="size-4" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-foreground">
          {agentAuthAgentLabel(agentKind)}
        </span>
        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
          {agentAuthHarnessDescription(agentKind)}
        </span>
      </span>
    </div>
  );
}

function LocalAuthCell({
  agentKind,
  localSource,
  localSourceError,
  provider,
  syncingLocalProvider,
  onSyncLocalCredential,
}: {
  agentKind: AgentAuthAgentKind;
  localSource: LocalAgentAuthSource | null;
  localSourceError: string | null;
  provider: AgentAuthProvider | null;
  syncingLocalProvider: AgentAuthProvider | null;
  onSyncLocalCredential: (provider: AgentAuthProvider) => void;
}) {
  if (!provider) {
    return (
      <div className="flex items-center justify-start">
        <Badge>Unsupported</Badge>
      </div>
    );
  }
  const detected = localSource?.detected === true;
  const label = localSourceError
    ? "Scan failed"
    : detected ? "Detected" : "Not detected";
  const tone: BadgeTone = localSourceError
    ? "destructive"
    : detected ? "success" : "neutral";
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge tone={tone}>{label}</Badge>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        loading={syncingLocalProvider === provider}
        disabled={!detected}
        onClick={() => onSyncLocalCredential(provider)}
      >
        Sync
      </Button>
      <span className="sr-only">{agentAuthAgentLabel(agentKind)}</span>
    </div>
  );
}

function PersonalCloudAuthCell({
  agentKind,
  capabilities,
  credentials,
  credentialsLoading,
  selecting,
  selection,
  onEnsurePersonalProfile,
  onSelectPersonalDefault,
}: {
  agentKind: AgentAuthAgentKind;
  capabilities: AgentGatewayCapabilities | null;
  credentials: AgentAuthCredential[];
  credentialsLoading: boolean;
  selecting: boolean;
  selection: SandboxAgentAuthSelection | undefined;
  onEnsurePersonalProfile: () => void;
  onSelectPersonalDefault: (agentKind: AgentAuthAgentKind, credentialId: string) => void;
}) {
  const selectedCredential = selection
    ? credentials.find((credential) => credential.id === selection.credentialId) ?? null
    : null;

  if (credentialsLoading) {
    return (
      <Button type="button" variant="outline" size="sm" disabled className="w-full justify-start">
        Loading...
      </Button>
    );
  }

  if (credentials.length === 0) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-full justify-start"
        onClick={() => onEnsurePersonalProfile()}
      >
        <ProviderIcon kind={agentKind} className="size-3.5 shrink-0 text-muted-foreground" />
        No credential
      </Button>
    );
  }

  return (
    <SettingsMenu
      label={selectedCredential?.displayName ?? "Choose credential"}
      leading={<ProviderIcon kind={agentKind} className="size-3.5 shrink-0 text-muted-foreground" />}
      className="w-full"
      menuClassName="w-72"
      groups={[
        {
          id: "credentials",
          label: agentAuthAgentLabel(agentKind),
          options: credentials.map((credential) => {
            const availability = agentAuthCredentialAvailability(credential, capabilities);
            const disabledReason = availability.reason
              ?? credentialSelectableReason(credential, "personal");
            return {
              id: credential.id,
              label: credential.displayName,
              icon: <ProviderIcon kind={credential.agentKind} className="size-3.5" />,
              detail: disabledReason
                ?? (credentialSummaryDetails(credential)
                  || agentAuthCredentialKindLabel(credential)),
              selected: selectedCredential?.id === credential.id,
              disabled: selecting || disabledReason !== null,
              onSelect: () => onSelectPersonalDefault(agentKind, credential.id),
            };
          }),
        },
      ]}
    />
  );
}

function AuthenticationMethodsSection({
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
