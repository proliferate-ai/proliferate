import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import type {
  AgentAuthAgentKind,
  AgentAuthCredential,
  AgentAuthCredentialProviderId,
  AgentGatewayCapabilities,
  SandboxAgentAuthSelection,
} from "@proliferate/cloud-sdk";
import { Button } from "@proliferate/ui/primitives/Button";
import { Badge, type BadgeTone } from "@proliferate/ui/primitives/Badge";
import { SettingsMenu } from "@proliferate/ui/primitives/SettingsMenu";
import { RefreshCw } from "@proliferate/ui/icons";
import { ProviderIcon } from "@proliferate/ui/provider-icons";
import { SettingsCard } from "@/components/settings/shared/SettingsCard";
import { SettingsCardRow } from "@/components/settings/shared/SettingsCardRow";
import { AuthenticationMethodsSection } from "@/components/settings/panes/agent-authentication/AuthenticationMethodsSection";
import { useAgentAuthLibraryActions } from "@/hooks/settings/workflows/use-agent-auth-library-actions";
import type {
  AgentAuthProvider,
  LocalAgentAuthSource,
} from "@/hooks/access/tauri/use-credentials-actions";
import {
  agentAuthHarnessDescription,
} from "@/lib/domain/agent-auth/agent-auth-agent-presentation";
import {
  agentAuthCredentialAvailability,
  agentAuthCredentialDisplayLabel,
  agentAuthCredentialKindLabel,
  credentialSelectableReason,
  credentialSummaryDetails,
} from "@/lib/domain/agent-auth/agent-auth-credential-presentation";
import {
  AGENT_AUTH_SLOT_DEFINITIONS,
  agentAuthSlotLabel,
  agentAuthSlotDomId,
  credentialsForAgentAuthSlot,
  selectionByAgentAuthSlot,
  type AgentAuthSlotDefinition,
} from "@/lib/domain/agent-auth/auth-slots";
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

function PersonalAuthInUseSection({
  capabilities,
  credentialsByProvider,
  credentialsLoading,
  localSourceError,
  localSourcesByProvider,
  personalSelections,
  rescanning,
  ensuringFreeCredits,
  selecting,
  syncingLocalProvider,
  onEnsureFreeCredits,
  onEnsurePersonalProfile,
  onRescan,
  onSelectPersonalDefault,
  onSyncLocalCredential,
}: {
  capabilities: AgentGatewayCapabilities | null;
  credentialsByProvider: Map<string, AgentAuthCredential[]>;
  credentialsLoading: boolean;
  localSourceError: string | null;
  localSourcesByProvider: Map<AgentAuthProvider, LocalAgentAuthSource>;
  personalSelections: SandboxAgentAuthSelection[];
  rescanning: boolean;
  ensuringFreeCredits: boolean;
  selecting: boolean;
  syncingLocalProvider: AgentAuthProvider | null;
  onEnsureFreeCredits: () => void;
  onEnsurePersonalProfile: () => void;
  onRescan: () => void;
  onSelectPersonalDefault: (
    agentKind: AgentAuthAgentKind,
    authSlotId: AgentAuthCredentialProviderId | string,
    credentialId: string,
  ) => void;
  onSyncLocalCredential: (provider: AgentAuthProvider) => void;
}) {
  const selectionsBySlot = selectionByAgentAuthSlot(personalSelections);
  const credentials = [...credentialsByProvider.values()].flat();
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
        {AGENT_AUTH_SLOT_DEFINITIONS.map((slot) => {
          const slotCredentials = credentialsForAgentAuthSlot(credentials, slot);
          return (
            <div
              key={`${slot.agentKind}-${slot.authSlotId}`}
              id={agentAuthSlotDomId(slot.agentKind, slot.authSlotId)}
              className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.1fr)] items-center gap-3 border-b border-border-light px-4 py-3 last:border-b-0"
            >
              <HarnessIdentity slot={slot} />
              <LocalAuthCell
                slot={slot}
                localSource={slot.localProvider
                  ? localSourcesByProvider.get(slot.localProvider) ?? null
                  : null}
                localSourceError={localSourceError}
                provider={slot.localProvider}
                syncingLocalProvider={syncingLocalProvider}
                onSyncLocalCredential={onSyncLocalCredential}
              />
              <PersonalCloudAuthCell
                slot={slot}
                capabilities={capabilities}
                credentials={slotCredentials}
                credentialsLoading={credentialsLoading}
                ensuringFreeCredits={ensuringFreeCredits}
                selecting={selecting}
                selection={selectionsBySlot.get(`${slot.agentKind}:${slot.authSlotId}`)}
                onEnsureFreeCredits={onEnsureFreeCredits}
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

function HarnessIdentity({ slot }: { slot: AgentAuthSlotDefinition }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-border-light bg-foreground/5 text-foreground">
        <ProviderIcon kind={slot.agentKind} className="size-4" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-foreground">
          {agentAuthSlotLabel(slot)}
        </span>
        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
          {agentAuthHarnessDescription(slot.agentKind)}
        </span>
      </span>
    </div>
  );
}

function LocalAuthCell({
  slot,
  localSource,
  localSourceError,
  provider,
  syncingLocalProvider,
  onSyncLocalCredential,
}: {
  slot: AgentAuthSlotDefinition;
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
      <span className="sr-only">{agentAuthSlotLabel(slot)}</span>
    </div>
  );
}

function PersonalCloudAuthCell({
  slot,
  capabilities,
  credentials,
  credentialsLoading,
  ensuringFreeCredits,
  selecting,
  selection,
  onEnsureFreeCredits,
  onEnsurePersonalProfile,
  onSelectPersonalDefault,
}: {
  slot: AgentAuthSlotDefinition;
  capabilities: AgentGatewayCapabilities | null;
  credentials: AgentAuthCredential[];
  credentialsLoading: boolean;
  ensuringFreeCredits: boolean;
  selecting: boolean;
  selection: SandboxAgentAuthSelection | undefined;
  onEnsureFreeCredits: () => void;
  onEnsurePersonalProfile: () => void;
  onSelectPersonalDefault: (
    agentKind: AgentAuthAgentKind,
    authSlotId: AgentAuthCredentialProviderId | string,
    credentialId: string,
  ) => void;
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
    const canUseFreeCredits = capabilities?.enabled === true
      && capabilities.managedCreditsPersonalEnabled
      && capabilities.managedCreditAgentKinds.includes(slot.agentKind);
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-full justify-start"
        loading={canUseFreeCredits && ensuringFreeCredits}
        onClick={() => {
          if (canUseFreeCredits) {
            onEnsureFreeCredits();
            return;
          }
          onEnsurePersonalProfile();
        }}
      >
        <ProviderIcon kind={slot.authSlotId} className="size-3.5 shrink-0 text-muted-foreground" />
        {canUseFreeCredits ? "Use free credits" : "No credential"}
      </Button>
    );
  }

  return (
    <SettingsMenu
      label={selectedCredential
        ? agentAuthCredentialDisplayLabel(selectedCredential)
        : "Choose credential"}
      leading={<ProviderIcon kind={slot.authSlotId} className="size-3.5 shrink-0 text-muted-foreground" />}
      className="w-full"
      menuClassName="w-72"
      groups={[
        {
          id: "credentials",
          label: `${agentAuthSlotLabel(slot)} credentials`,
          options: credentials.map((credential) => {
            const availability = agentAuthCredentialAvailability(credential, capabilities);
            const disabledReason = availability.reason
              ?? credentialSelectableReason(credential, "personal");
            return {
              id: credential.id,
              label: agentAuthCredentialDisplayLabel(credential),
              icon: <ProviderIcon kind={credential.credentialProviderId} className="size-3.5" />,
              detail: disabledReason
                ?? (credentialSummaryDetails(credential)
                  || agentAuthCredentialKindLabel(credential)),
              selected: selectedCredential?.id === credential.id,
              disabled: selecting || disabledReason !== null,
              onSelect: () =>
                onSelectPersonalDefault(slot.agentKind, slot.authSlotId, credential.id),
            };
          }),
        },
      ]}
    />
  );
}
