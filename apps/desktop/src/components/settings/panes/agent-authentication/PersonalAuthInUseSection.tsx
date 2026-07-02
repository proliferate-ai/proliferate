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
import { SettingsEyebrow } from "@proliferate/product-ui/settings/SettingsEyebrow";
import { SettingsSection } from "@proliferate/product-ui/settings/SettingsSection";
import { RefreshCw } from "@proliferate/ui/icons";
import { ProviderIcon } from "@proliferate/ui/provider-icons";
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
  agentAuthSlotDefinitions,
  agentAuthSlotDomId,
  agentAuthSlotLabel,
  credentialsForAgentAuthSlot,
  selectionByAgentAuthSlot,
  type AgentAuthSlotDefinition,
} from "@/lib/domain/agent-auth/auth-slots";

export function PersonalAuthInUseSection({
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
  const slots = agentAuthSlotDefinitions(capabilities);
  return (
    <SettingsSection
      title="In use"
      description="Pick the credential each agent uses in local and personal cloud sandboxes."
      action={
        <Button
          type="button"
          variant="secondary"
          size="sm"
          loading={rescanning}
          onClick={() => onRescan()}
        >
          <RefreshCw className="size-3.5" />
          Rescan
        </Button>
      }
    >
      <div>
        <SettingsEyebrow className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.1fr)] gap-3 border-b border-border bg-foreground/5 py-2">
          <span>Agent</span>
          <span>Local sandbox</span>
          <span>Personal cloud</span>
        </SettingsEyebrow>
        {slots.map((slot) => {
          const slotCredentials = credentialsForAgentAuthSlot(credentials, slot);
          return (
            <div
              key={`${slot.agentKind}-${slot.authSlotId}`}
              id={agentAuthSlotDomId(slot.agentKind, slot.authSlotId)}
              className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.1fr)] items-center gap-3 border-b border-border py-3 last:border-b-0"
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
      </div>
    </SettingsSection>
  );
}

function HarnessIdentity({ slot }: { slot: AgentAuthSlotDefinition }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-foreground/5 text-foreground">
        <ProviderIcon kind={slot.agentKind} className="size-4" />
      </span>
      <span className="min-w-0">
        <span className="block text-ui font-medium text-foreground">
          {agentAuthSlotLabel(slot)}
        </span>
        <span className="mt-0.5 block truncate text-ui-sm text-muted-foreground">
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
        Loading…
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
        {canUseFreeCredits ? "Use free credits" : "Set up credential"}
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
