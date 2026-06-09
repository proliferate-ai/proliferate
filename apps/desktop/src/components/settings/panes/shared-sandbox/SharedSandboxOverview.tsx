import type {
  AgentAuthAgentKind,
  AgentAuthCredential,
  AgentAuthCredentialProviderId,
  AgentGatewayCapabilities,
  SandboxAgentAuthSelection,
} from "@proliferate/cloud-sdk";
import { Button } from "@proliferate/ui/primitives/Button";
import { Badge } from "@proliferate/ui/primitives/Badge";
import { SettingsMenu } from "@proliferate/ui/primitives/SettingsMenu";
import {
  CalendarClock,
  Check,
  Hash,
  RefreshCw,
  Terminal,
  UsersRound,
} from "@proliferate/ui/icons";
import { SettingsCard } from "@/components/settings/shared/SettingsCard";
import { ProviderIcon } from "@proliferate/ui/provider-icons";
import { useConnectors } from "@/hooks/access/mcp/connectors/use-connectors";
import { useInstalledConnectorActions } from "@/hooks/mcp/workflows/use-installed-connector-actions";
import { useAgentAuthLibraryActions } from "@/hooks/settings/workflows/use-agent-auth-library-actions";
import { SharedPluginsSection } from "@/components/settings/panes/shared-sandbox/SharedPluginsSection";
import { buildPluginSharedExposurePresentation } from "@/lib/domain/plugins/plugin-package-view-model";
import {
  AGENT_AUTH_SLOT_DEFINITIONS,
  agentAuthSlotLabel,
  credentialsForAgentAuthSlot,
  selectionByAgentAuthSlot,
  type AgentAuthSlotDefinition,
} from "@/lib/domain/agent-auth/auth-slots";
import {
  agentAuthCredentialAvailability,
  agentAuthCredentialKindLabel,
  credentialSelectableReason,
  credentialSummaryDetails,
} from "@/lib/domain/agent-auth/agent-auth-credential-presentation";

export function SharedSandboxOverview({
  organizationId,
}: {
  organizationId: string;
}) {
  const agentAuthLibrary = useAgentAuthLibraryActions(null, organizationId, {
    autoLoadPersonalProfile: false,
  });
  const connectorsQuery = useConnectors();
  const connectorActions = useInstalledConnectorActions();
  const installedPlugins = connectorsQuery.data?.installed ?? [];
  const exposedPlugins = installedPlugins.filter((record) =>
    buildPluginSharedExposurePresentation(record).hasPublicItems
  );
  const configuredAuthSlotCount = countConfiguredAuthSlots(
    agentAuthLibrary.selections,
    agentAuthLibrary.organizationCredentials,
  );
  const readinessLoading =
    agentAuthLibrary.organizationSelectionsLoading
    || agentAuthLibrary.organizationCredentialsLoading
    || connectorsQuery.isLoading;
  const ready = !readinessLoading && configuredAuthSlotCount > 0;

  return (
    <>
      <SharedRuntimeScopeCard />

      <SharedReadinessCard
        configuredAuthSlotCount={configuredAuthSlotCount}
        exposedPluginCount={exposedPlugins.length}
        loading={readinessLoading}
        ready={ready}
        verifying={readinessLoading || agentAuthLibrary.ensuringProfile || connectorsQuery.isFetching}
        onVerify={agentAuthLibrary.handleEnsureOrganizationProfile}
      />

      {agentAuthLibrary.feedback && (
        <p className="text-xs leading-4 text-muted-foreground">{agentAuthLibrary.feedback}</p>
      )}

      <SharedAgentAuthenticationSection
        credentials={agentAuthLibrary.organizationCredentials}
        capabilities={agentAuthLibrary.capabilities}
        selections={agentAuthLibrary.selections}
        ensuringProfile={agentAuthLibrary.ensuringProfile}
        selectingTeamDefault={agentAuthLibrary.selectingTeamDefault}
        onSelectTeamDefault={agentAuthLibrary.handleSelectTeamDefault}
      />

      <SharedPluginsSection
        organizationId={organizationId}
        installed={installedPlugins}
        loading={connectorsQuery.isLoading}
        isPending={(connectionId) => connectorActions.isPending(connectionId)}
        onSetSharedExposure={(record, expose) => {
          void connectorActions.onSetSharedExposure(record, organizationId, expose);
        }}
      />
    </>
  );
}

function SharedRuntimeScopeCard() {
  const items = [
    {
      icon: Hash,
      title: "Slack-created workspaces",
      description: "From channels and DMs",
    },
    {
      icon: UsersRound,
      title: "Shared team workspaces",
      description: "Assigned to teammates",
    },
    {
      icon: CalendarClock,
      title: "Shared automations",
      description: "Sentry triage, schedules, alerts",
    },
    {
      icon: Terminal,
      title: "API-dispatched workspaces",
      description: "External integrations",
    },
  ];
  return (
    <div className="rounded-xl border border-border bg-surface-elevated-secondary p-5">
      <p className="text-sm font-medium text-foreground">
        Changes here affect every team member&apos;s:
      </p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <div key={item.title} className="flex items-start gap-3">
              <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <div className="text-sm font-medium text-foreground">{item.title}</div>
                <div className="mt-0.5 text-sm text-muted-foreground">{item.description}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SharedReadinessCard({
  configuredAuthSlotCount,
  exposedPluginCount,
  loading,
  ready,
  verifying,
  onVerify,
}: {
  configuredAuthSlotCount: number;
  exposedPluginCount: number;
  loading: boolean;
  ready: boolean;
  verifying: boolean;
  onVerify: () => void;
}) {
  return (
    <div className="flex items-center gap-4 rounded-xl border border-border bg-surface-elevated-secondary px-5 py-4">
      <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-foreground/10 text-foreground">
        <Check className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-foreground">
          {loading
            ? "Checking configuration"
            : ready ? "Ready · team work can run" : "Needs configuration"}
        </div>
        <div className="mt-1 text-sm text-muted-foreground">
          {loading
            ? "Loading shared sandbox auth and plugin exposure"
            : `${configuredAuthSlotCount} of ${AGENT_AUTH_SLOT_DEFINITIONS.length} auth slots configured · ${exposedPluginCount} plugins exposed · Last verified just now`}
        </div>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        loading={verifying}
        onClick={() => onVerify()}
      >
        <RefreshCw className="size-3.5" />
        Re-verify
      </Button>
    </div>
  );
}

function SharedAgentAuthenticationSection({
  credentials,
  capabilities,
  selections,
  ensuringProfile,
  selectingTeamDefault,
  onSelectTeamDefault,
}: {
  credentials: AgentAuthCredential[];
  capabilities: AgentGatewayCapabilities | null;
  selections: SandboxAgentAuthSelection[];
  ensuringProfile: boolean;
  selectingTeamDefault: boolean;
  onSelectTeamDefault: (
    agentKind: AgentAuthAgentKind,
    authSlotId: AgentAuthCredentialProviderId | string,
    credentialId: string,
  ) => void;
}) {
  const selectionsBySlot = selectionByAgentAuthSlot(selections);
  return (
    <section className="space-y-3">
      <div className="space-y-1">
        <h2 className="text-sm font-medium text-foreground">Agent Authentication</h2>
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
          One credential per auth slot. Pick from managed credits, org API keys,
          or synced credentials available to this team.
        </p>
      </div>
      <SettingsCard>
        <div className="grid grid-cols-[minmax(8rem,1fr)_minmax(12rem,2fr)_minmax(7rem,0.8fr)_7rem] gap-4 border-b border-border-light bg-foreground/5 px-5 py-3 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
          <span>Auth slot</span>
          <span>Team credential</span>
          <span>Type</span>
          <span className="text-right">Action</span>
        </div>
        {AGENT_AUTH_SLOT_DEFINITIONS.map((slot) => (
          <SharedAgentAuthRow
            key={`${slot.agentKind}-${slot.authSlotId}`}
            slot={slot}
            capabilities={capabilities}
            credentials={credentialsForAgentAuthSlot(credentials, slot)}
            selection={selectionsBySlot.get(`${slot.agentKind}:${slot.authSlotId}`)}
            selecting={selectingTeamDefault || ensuringProfile}
            onSelectTeamDefault={onSelectTeamDefault}
          />
        ))}
      </SettingsCard>
    </section>
  );
}

function SharedAgentAuthRow({
  slot,
  credentials,
  capabilities,
  selection,
  selecting,
  onSelectTeamDefault,
}: {
  slot: AgentAuthSlotDefinition;
  credentials: AgentAuthCredential[];
  capabilities: AgentGatewayCapabilities | null;
  selection: SandboxAgentAuthSelection | undefined;
  selecting: boolean;
  onSelectTeamDefault: (
    agentKind: AgentAuthAgentKind,
    authSlotId: AgentAuthCredentialProviderId | string,
    credentialId: string,
  ) => void;
}) {
  const selectedCredential = selection
    ? credentials.find((credential) => credential.id === selection.credentialId) ?? null
    : null;
  const selectedMissing = Boolean(selection && !selectedCredential);
  const selectedReason = selectedCredential
    ? agentAuthCredentialAvailability(selectedCredential, capabilities).reason
      ?? credentialSelectableReason(selectedCredential, "organization")
    : null;
  const rowTone = selectedCredential && !selectedReason ? "text-foreground" : "text-muted-foreground";
  const menuOptions = credentials.map((credential) => {
    const availability = agentAuthCredentialAvailability(credential, capabilities);
    const disabledReason = availability.reason
      ?? credentialSelectableReason(credential, "organization");
    return {
      id: credential.id,
      label: credential.displayName,
      detail: disabledReason ?? credentialSummaryDetails(credential) ?? agentAuthCredentialKindLabel(credential),
      selected: selectedCredential?.id === credential.id,
      disabled: selecting || disabledReason !== null,
      onSelect: () => onSelectTeamDefault(slot.agentKind, slot.authSlotId, credential.id),
    };
  });
  return (
    <div className="grid grid-cols-[minmax(8rem,1fr)_minmax(12rem,2fr)_minmax(7rem,0.8fr)_7rem] items-center gap-4 border-b border-border-light px-5 py-4 last:border-b-0">
      <div className="flex min-w-0 items-center gap-3">
        <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-foreground/5 text-muted-foreground">
          <ProviderIcon kind={slot.agentKind} className="size-4" />
        </span>
        <span className={`truncate text-sm font-medium ${rowTone}`}>
          {agentAuthSlotLabel(slot)}
        </span>
      </div>
      <div className="min-w-0">
        {selectedCredential ? (
          <>
            <div className="flex min-w-0 items-center gap-2 text-sm font-medium text-foreground">
              <span className="size-1.5 shrink-0 rounded-full bg-foreground/80" />
              <span className="truncate">{selectedCredential.displayName}</span>
            </div>
            <div className="mt-1 truncate text-xs text-muted-foreground">
              {selectedReason ?? credentialSummaryDetails(selectedCredential) ?? "Ready for shared sandbox"}
            </div>
          </>
        ) : (
          <div className="text-sm italic text-muted-foreground">
            {selectedMissing ? "Selected credential is no longer visible" : "No credential set"}
          </div>
        )}
      </div>
      <div>
        {selectedCredential ? (
          <Badge>
            {sharedCredentialTypeBadgeLabel(selectedCredential)}
          </Badge>
        ) : (
          <span className="text-sm text-muted-foreground">—</span>
        )}
      </div>
      <div className="flex justify-end">
        {menuOptions.length > 0 ? (
          <SettingsMenu
            label={selectedCredential ? "Change" : "Configure"}
            className="w-28"
            menuClassName="w-80"
            groups={[{
              id: `${slot.agentKind}-${slot.authSlotId}`,
              label: agentAuthSlotLabel(slot),
              options: menuOptions,
            }]}
          />
        ) : (
          <Button type="button" variant="ghost" size="sm" disabled>
            Configure
          </Button>
        )}
      </div>
    </div>
  );
}

function sharedCredentialTypeBadgeLabel(credential: AgentAuthCredential): string {
  if (credential.credentialKind === "synced_path") {
    return "Synced";
  }
  if (credential.credentialKind !== "managed_gateway") {
    return agentAuthCredentialKindLabel(credential);
  }
  const providerKind = credential.redactedSummary.providerKind;
  if (
    providerKind === "proliferate_bedrock_pool"
    || providerKind === "proliferate_managed_anthropic"
    || providerKind === "proliferate_managed_openai"
    || providerKind === "proliferate_managed_gemini"
  ) {
    return "Managed";
  }
  if (
    providerKind === "anthropic_api_key"
    || providerKind === "openai_api_key"
    || providerKind === "gemini_api_key"
  ) {
    return "API key";
  }
  if (providerKind === "bedrock_assume_role") {
    return "Bedrock";
  }
  if (providerKind === "openai_compatible") {
    return "Gateway";
  }
  return "Gateway";
}

function countConfiguredAuthSlots(
  selections: SandboxAgentAuthSelection[],
  credentials: AgentAuthCredential[],
): number {
  const credentialIds = new Set(credentials.map((credential) => credential.id));
  return selections.filter((selection) => credentialIds.has(selection.credentialId)).length;
}
