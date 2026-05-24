import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import type {
  AgentAuthAgentKind,
  AgentAuthCredential,
  AgentGatewayCapabilities,
  SandboxAgentAuthSelection,
} from "@proliferate/cloud-sdk";
import { useAgentAuthMutations } from "@proliferate/cloud-sdk-react/hooks/agent-auth";
import { Button } from "@proliferate/ui/primitives/Button";
import { Input } from "@proliferate/ui/primitives/Input";
import { Badge } from "@/components/ui/Badge";
import { ModalShell } from "@/components/ui/ModalShell";
import { SettingsMenu } from "@/components/ui/SettingsMenu";
import {
  CalendarClock,
  Check,
  CloudIcon,
  Hash,
  Plus,
  RefreshCw,
  Search,
  Terminal,
  UsersRound,
} from "@/components/ui/icons";
import {
  EnvironmentField,
  EnvironmentSection,
} from "@/components/ui/EnvironmentLayout";
import { RepoEnvVarsCard } from "@/components/cloud/repo-settings/RepoEnvVarsCard";
import { RepoRunCommandCard } from "@/components/cloud/repo-settings/RepoRunCommandCard";
import { RepoSharedEnvFilesCard } from "@/components/cloud/repo-settings/RepoSharedEnvFilesCard";
import { RepoSetupScriptCard } from "@/components/cloud/repo-settings/RepoSetupScriptCard";
import { AdminOnlyPlaceholder } from "@/components/settings/shared/AdminOnlyPlaceholder";
import { SettingsCard } from "@/components/settings/shared/SettingsCard";
import { SettingsCardRow } from "@/components/settings/shared/SettingsCardRow";
import { SettingsPageHeader } from "@/components/settings/shared/SettingsPageHeader";
import { ConnectorIcon } from "@/components/plugins/status/ConnectorIcon";
import { ProviderIcon } from "@/components/ui/provider-icons";
import type { SettingsSection } from "@/config/settings";
import { useOrganizationCloudRepoConfig } from "@/hooks/access/cloud/use-cloud-repo-config";
import { useOrganizationCloudRepoConfigs } from "@/hooks/access/cloud/use-cloud-repo-configs";
import { useSaveOrganizationCloudRepoConfig } from "@/hooks/access/cloud/use-save-organization-cloud-repo-config";
import { useConnectors } from "@/hooks/access/mcp/connectors/use-connectors";
import { useCloudRepoConfigDraft } from "@/hooks/cloud/ui/use-cloud-repo-config-draft";
import { useInstalledConnectorActions } from "@/hooks/mcp/workflows/use-installed-connector-actions";
import { useAgentAuthLibraryActions } from "@/hooks/settings/workflows/use-agent-auth-library-actions";
import type { CloudRepoConfigSummary } from "@/lib/domain/cloud/repo-configs";
import {
  cloudRepositoryKey,
  isCloudRepository,
  type CloudSettingsRepositoryEntry,
  type SettingsRepositoryEntry,
} from "@/lib/domain/settings/repositories";
import type { InstalledConnectorRecord } from "@/lib/domain/mcp/types";
import { resolveConnectorStatus } from "@/lib/domain/mcp/connector-catalog-view-model";
import {
  buildConnectedPluginPresentation,
  buildPluginSharedExposurePresentation,
} from "@/lib/domain/plugins/plugin-package-view-model";
import {
  AGENT_AUTH_AGENT_ORDER,
  agentAuthAgentLabel,
  agentAuthCredentialAvailability,
  agentAuthCredentialKindLabel,
  credentialSelectableReason,
  credentialSummaryDetails,
  selectionByAgentKind,
} from "@/lib/domain/agent-auth/agent-auth-presentation";
import { buildSettingsHref, type SettingsFocus } from "@/lib/domain/settings/navigation";

interface SharedEnvironmentsPaneProps {
  isAdmin: boolean;
  isCheckingAdmin: boolean;
  role: string | null;
  activeOrganizationId: string | null;
  repositories: SettingsRepositoryEntry[];
  focus?: SettingsFocus;
  onOpenSettingsSection: (section: SettingsSection) => void;
}

interface SharedEnvironmentEntry {
  key: string;
  gitOwner: string;
  gitRepoName: string;
  label: string;
  description: string;
  configured: boolean;
  configuredAt: string | null;
  localRepository: CloudSettingsRepositoryEntry | null;
}

export function SharedEnvironmentsPane({
  isAdmin,
  isCheckingAdmin,
  role,
  activeOrganizationId,
  repositories,
  focus,
  onOpenSettingsSection,
}: SharedEnvironmentsPaneProps) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const navigate = useNavigate();
  const organizationConfigs = useOrganizationCloudRepoConfigs(
    activeOrganizationId,
    isAdmin && activeOrganizationId !== null,
  );
  const entries = useMemo(
    () => buildSharedEnvironmentEntries(
      repositories,
      organizationConfigs.data?.configs ?? [],
    ),
    [organizationConfigs.data?.configs, repositories],
  );
  const focusedKey = focus?.cloudRepoOwner && focus.cloudRepoName
    ? cloudRepositoryKey(focus.cloudRepoOwner, focus.cloudRepoName)
    : null;
  useEffect(() => {
    if (!focusedKey || selectedKey === focusedKey) {
      return;
    }
    if (entries.some((entry) => entry.key === focusedKey)) {
      setSelectedKey(focusedKey);
    }
  }, [entries, focusedKey, selectedKey]);
  const selectedEntry = entries.find((entry) => entry.key === selectedKey) ?? null;

  if (isCheckingAdmin) {
    return (
      <SharedEnvironmentsShell>
        <SettingsCard>
          <div className="p-3 text-sm text-muted-foreground">Checking admin access...</div>
        </SettingsCard>
      </SharedEnvironmentsShell>
    );
  }

  if (!isAdmin) {
    return (
      <SharedEnvironmentsShell>
        <AdminOnlyPlaceholder
          role={role}
          onOpenOrganization={() => onOpenSettingsSection("organization")}
        />
      </SharedEnvironmentsShell>
    );
  }

  if (activeOrganizationId === null) {
    return (
      <SharedEnvironmentsShell>
        <SettingsCard>
          <SettingsCardRow
            label="Select an organization"
            description="Shared Sandbox is configured per organization."
          >
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenSettingsSection("organization")}
            >
              Open
            </Button>
          </SettingsCardRow>
        </SettingsCard>
      </SharedEnvironmentsShell>
    );
  }

  if (selectedEntry) {
    return (
      <SharedEnvironmentDetail
        organizationId={activeOrganizationId}
        entry={selectedEntry}
        onBack={() => {
          setSelectedKey(null);
          navigate(buildSettingsHref({ section: "shared-environments" }));
        }}
      />
    );
  }

  return (
    <SharedEnvironmentsShell>
      <SharedSandboxOverview
        organizationId={activeOrganizationId}
      />
    </SharedEnvironmentsShell>
  );
}

function SharedSandboxOverview({
  organizationId,
}: {
  organizationId: string;
}) {
  const agentAuthLibrary = useAgentAuthLibraryActions(null, organizationId);
  const connectorsQuery = useConnectors();
  const connectorActions = useInstalledConnectorActions();
  const installedPlugins = connectorsQuery.data?.installed ?? [];
  const exposedPlugins = installedPlugins.filter((record) =>
    buildPluginSharedExposurePresentation(record).hasPublicItems
  );
  const configuredHarnessCount = countConfiguredHarnesses(
    agentAuthLibrary.selections,
    agentAuthLibrary.organizationCredentials,
  );
  const readinessLoading =
    agentAuthLibrary.organizationSelectionsLoading
    || agentAuthLibrary.organizationCredentialsLoading
    || connectorsQuery.isLoading;
  const ready = !readinessLoading && configuredHarnessCount > 0;

  return (
    <>
      <SharedRuntimeScopeCard />

      <SharedReadinessCard
        configuredHarnessCount={configuredHarnessCount}
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
  configuredHarnessCount,
  exposedPluginCount,
  loading,
  ready,
  verifying,
  onVerify,
}: {
  configuredHarnessCount: number;
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
            : `${configuredHarnessCount} of ${AGENT_AUTH_AGENT_ORDER.length} harnesses configured · ${exposedPluginCount} plugins exposed · Last verified just now`}
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
  onSelectTeamDefault: (agentKind: AgentAuthAgentKind, credentialId: string) => void;
}) {
  const selectionsByAgent = selectionByAgentKind(selections);
  return (
    <section className="space-y-3">
      <div className="space-y-1">
        <h2 className="text-sm font-medium text-foreground">Agent Authentication</h2>
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
          One credential per harness. Pick from managed credits, org API keys,
          or synced credentials available to this team.
        </p>
      </div>
      <SettingsCard>
        <div className="grid grid-cols-[minmax(8rem,1fr)_minmax(12rem,2fr)_minmax(7rem,0.8fr)_7rem] gap-4 border-b border-border-light bg-foreground/5 px-5 py-3 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
          <span>Harness</span>
          <span>Team credential</span>
          <span>Type</span>
          <span className="text-right">Action</span>
        </div>
        {AGENT_AUTH_AGENT_ORDER.map((agentKind) => (
          <SharedAgentAuthRow
            key={agentKind}
            agentKind={agentKind}
            capabilities={capabilities}
            credentials={credentials.filter((credential) => credential.agentKind === agentKind)}
            selection={selectionsByAgent.get(agentKind)}
            selecting={selectingTeamDefault || ensuringProfile}
            onSelectTeamDefault={onSelectTeamDefault}
          />
        ))}
      </SettingsCard>
    </section>
  );
}

function SharedAgentAuthRow({
  agentKind,
  credentials,
  capabilities,
  selection,
  selecting,
  onSelectTeamDefault,
}: {
  agentKind: AgentAuthAgentKind;
  credentials: AgentAuthCredential[];
  capabilities: AgentGatewayCapabilities | null;
  selection: SandboxAgentAuthSelection | undefined;
  selecting: boolean;
  onSelectTeamDefault: (agentKind: AgentAuthAgentKind, credentialId: string) => void;
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
      onSelect: () => onSelectTeamDefault(agentKind, credential.id),
    };
  });
  return (
    <div className="grid grid-cols-[minmax(8rem,1fr)_minmax(12rem,2fr)_minmax(7rem,0.8fr)_7rem] items-center gap-4 border-b border-border-light px-5 py-4 last:border-b-0">
      <div className="flex min-w-0 items-center gap-3">
        <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-foreground/5 text-muted-foreground">
          <ProviderIcon kind={agentKind} className="size-4" />
        </span>
        <span className={`truncate text-sm font-medium ${rowTone}`}>
          {agentAuthAgentLabel(agentKind)}
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
              id: agentKind,
              label: agentAuthAgentLabel(agentKind),
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
  if (providerKind === "proliferate_bedrock_pool") {
    return "Managed";
  }
  if (providerKind === "anthropic_api_key" || providerKind === "openai_api_key") {
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

function SharedPluginsSection({
  organizationId,
  installed,
  loading,
  isPending,
  onSetSharedExposure,
}: {
  organizationId: string;
  installed: InstalledConnectorRecord[];
  loading: boolean;
  isPending: (connectionId: string) => boolean;
  onSetSharedExposure: (record: InstalledConnectorRecord, expose: boolean) => void;
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const exposed = installed.filter((record) =>
    buildPluginSharedExposurePresentation(record).hasPublicItems
  );
  const availableToExpose = installed.length - exposed.length;
  return (
    <section className="space-y-3">
      <div className="space-y-1">
        <h2 className="text-sm font-medium text-foreground">
          Exposed Plugins
        </h2>
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
          MCP servers, skills, and plugin capabilities the shared sandbox is allowed to call.
          Add from your team&apos;s library.
        </p>
      </div>
      <SettingsCard>
        {loading ? (
          <div className="p-3 text-sm text-muted-foreground">Loading plugins...</div>
        ) : installed.length === 0 ? (
          <div className="p-3 text-sm text-muted-foreground">
            No plugins are installed yet. Install personal plugins from Plugins, then expose the ones shared work can use.
          </div>
        ) : exposed.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground">
            No plugins are exposed to the shared sandbox yet.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-[minmax(12rem,2fr)_minmax(8rem,1fr)_minmax(7rem,0.8fr)_6rem] gap-4 border-b border-border-light bg-foreground/5 px-5 py-3 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
              <span>Plugin</span>
              <span>Contributor</span>
              <span>Type</span>
              <span className="text-right">Action</span>
            </div>
            {exposed.map((record) => (
              <SharedPluginRow
                key={record.metadata.connectionId}
                record={record}
                pending={isPending(record.metadata.connectionId)}
                onSetSharedExposure={onSetSharedExposure}
              />
            ))}
          </>
        )}
      </SettingsCard>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setModalOpen(true)}
      >
        <Plus className="size-3.5" />
        Add plugin or MCP from team library · {availableToExpose} available
      </Button>
      {modalOpen ? (
        <SharedPluginLibraryModal
          installed={installed}
          loading={loading}
          organizationId={organizationId}
          isPending={isPending}
          onClose={() => setModalOpen(false)}
          onSetSharedExposure={onSetSharedExposure}
        />
      ) : null}
    </section>
  );
}

function SharedPluginRow({
  record,
  pending,
  onSetSharedExposure,
}: {
  record: InstalledConnectorRecord;
  pending: boolean;
  onSetSharedExposure: (record: InstalledConnectorRecord, expose: boolean) => void;
}) {
  const exposure = buildPluginSharedExposurePresentation(record);
  const presentation = buildConnectedPluginPresentation(record, resolveConnectorStatus(record));
  return (
    <div className="grid grid-cols-[minmax(12rem,2fr)_minmax(8rem,1fr)_minmax(7rem,0.8fr)_6rem] items-center gap-4 border-b border-border-light px-5 py-4 last:border-b-0">
      <div className="flex min-w-0 items-center gap-3">
        <ConnectorIcon entry={record.catalogEntry} size="sm" />
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-medium text-foreground">
              {record.catalogEntry.name}
            </span>
            <span className="text-xs uppercase tracking-wide text-muted-foreground">
              {pluginKindLabel(record)}
            </span>
          </div>
          <div className="mt-1 truncate text-xs text-muted-foreground">
            {presentation.capabilitySummary}
          </div>
        </div>
      </div>
      <div className="truncate text-sm text-muted-foreground">
        {pluginContributorLabel(record)}
      </div>
      <div>
        <Badge tone={sharedExposureTone(exposure.sharedCloudTone)}>
          {exposure.sharedCloudLabel}
        </Badge>
      </div>
      <div className="flex justify-end">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          loading={pending}
          onClick={() => onSetSharedExposure(record, false)}
        >
          Hide
        </Button>
      </div>
    </div>
  );
}

type SharedPluginLibraryCategory = "all" | "available" | "exposed" | "needs-setup" | "mcp" | "skills";

const SHARED_PLUGIN_LIBRARY_CATEGORIES: {
  id: SharedPluginLibraryCategory;
  label: string;
}[] = [
  { id: "all", label: "All plugins" },
  { id: "available", label: "Available" },
  { id: "exposed", label: "Exposed" },
  { id: "needs-setup", label: "Needs setup" },
  { id: "mcp", label: "MCP servers" },
  { id: "skills", label: "Skills" },
];

function SharedPluginLibraryModal({
  installed,
  loading,
  isPending,
  onClose,
  onSetSharedExposure,
}: {
  installed: InstalledConnectorRecord[];
  loading: boolean;
  organizationId: string;
  isPending: (connectionId: string) => boolean;
  onClose: () => void;
  onSetSharedExposure: (record: InstalledConnectorRecord, expose: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<SharedPluginLibraryCategory>("all");
  const normalizedQuery = query.trim().toLowerCase();
  const filtered = installed.filter((record) =>
    sharedPluginMatchesCategory(record, category)
    && sharedPluginMatchesQuery(record, normalizedQuery)
  );
  const counts = Object.fromEntries(
    SHARED_PLUGIN_LIBRARY_CATEGORIES.map((item) => [
      item.id,
      installed.filter((record) => sharedPluginMatchesCategory(record, item.id)).length,
    ]),
  ) as Record<SharedPluginLibraryCategory, number>;
  const activeLabel = SHARED_PLUGIN_LIBRARY_CATEGORIES.find((item) => item.id === category)?.label
    ?? "All plugins";

  return (
    <ModalShell
      open
      title="Add plugin or MCP from team library"
      description="Expose installed plugins, MCP servers, and skills to shared sandbox work."
      onClose={onClose}
      sizeClassName="max-w-[920px] h-[680px] max-h-[82vh]"
      bodyClassName="flex min-h-0 flex-1 overflow-hidden p-0"
    >
      <div className="grid min-h-0 flex-1 grid-cols-[13rem_minmax(0,1fr)] overflow-hidden border-t border-border-light">
        <aside className="overflow-y-auto border-r border-border-light p-3">
          <div className="space-y-1">
            {SHARED_PLUGIN_LIBRARY_CATEGORIES.map((item) => {
              const active = item.id === category;
              return (
                <Button
                  key={item.id}
                  type="button"
                  variant="unstyled"
                  size="unstyled"
                  onClick={() => setCategory(item.id)}
                  className={`flex w-full justify-between rounded-lg px-2 py-1.5 text-left text-sm font-medium ${
                    active
                      ? "bg-foreground/10 text-foreground"
                      : "text-muted-foreground hover:bg-foreground/[0.055] hover:text-foreground"
                  }`}
                >
                  <span className="truncate">{item.label}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{counts[item.id]}</span>
                </Button>
              );
            })}
          </div>
        </aside>
        <div className="flex min-h-0 flex-col overflow-hidden">
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border-light px-4 py-3">
            <h3 className="text-sm font-medium text-foreground">{activeLabel}</h3>
            <div className="relative w-72 max-w-full">
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search plugins..."
                aria-label="Search shared plugin library"
                className="pl-9"
              />
              <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {loading ? (
              <div className="text-sm text-muted-foreground">Loading plugins...</div>
            ) : installed.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border-light p-4 text-sm text-muted-foreground">
                No installed plugins are available. Install plugins from the Plugins page first.
              </div>
            ) : filtered.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border-light p-4 text-sm text-muted-foreground">
                No plugins match this view.
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                {filtered.map((record) => (
                  <SharedPluginLibraryCard
                    key={record.metadata.connectionId}
                    record={record}
                    pending={isPending(record.metadata.connectionId)}
                    onSetSharedExposure={onSetSharedExposure}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </ModalShell>
  );
}

function SharedPluginLibraryCard({
  record,
  pending,
  onSetSharedExposure,
}: {
  record: InstalledConnectorRecord;
  pending: boolean;
  onSetSharedExposure: (record: InstalledConnectorRecord, expose: boolean) => void;
}) {
  const exposure = buildPluginSharedExposurePresentation(record);
  const status = resolveConnectorStatus(record);
  const presentation = buildConnectedPluginPresentation(record, status);
  const exposed = exposure.hasPublicItems;
  return (
    <article className="flex min-h-32 flex-col justify-between rounded-xl border border-border bg-surface-elevated-secondary p-4 transition-colors hover:bg-list-hover">
      <div className="flex min-w-0 gap-3">
        <ConnectorIcon entry={record.catalogEntry} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="truncate text-sm font-medium text-foreground">
              {record.catalogEntry.name}
            </span>
            <Badge tone={status.actionable ? "warning" : "neutral"}>
              {status.label}
            </Badge>
          </div>
          <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
            {record.catalogEntry.oneLiner}
          </p>
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between gap-3">
        <div className="min-w-0 truncate text-xs text-muted-foreground">
          {presentation.capabilitySummary} · {pluginContributorLabel(record)}
        </div>
        <Button
          type="button"
          variant={exposed ? "ghost" : "secondary"}
          size="sm"
          loading={pending}
          onClick={() => onSetSharedExposure(record, !exposed)}
        >
          {exposed ? "Hide" : "Expose"}
        </Button>
      </div>
    </article>
  );
}

function countConfiguredHarnesses(
  selections: SandboxAgentAuthSelection[],
  credentials: AgentAuthCredential[],
): number {
  const credentialIds = new Set(credentials.map((credential) => credential.id));
  return AGENT_AUTH_AGENT_ORDER.filter((agentKind) => {
    const selection = selections.find((candidate) => candidate.agentKind === agentKind);
    return selection ? credentialIds.has(selection.credentialId) : false;
  }).length;
}

function sharedPluginMatchesQuery(
  record: InstalledConnectorRecord,
  normalizedQuery: string,
): boolean {
  if (!normalizedQuery) {
    return true;
  }
  const haystack = [
    record.catalogEntry.name,
    record.catalogEntry.oneLiner,
    record.catalogEntry.description,
    record.catalogEntry.serverNameBase,
    pluginContributorLabel(record),
  ].join(" ").toLowerCase();
  return haystack.includes(normalizedQuery);
}

function sharedPluginMatchesCategory(
  record: InstalledConnectorRecord,
  category: SharedPluginLibraryCategory,
): boolean {
  const exposure = buildPluginSharedExposurePresentation(record);
  if (category === "all") {
    return true;
  }
  if (category === "available") {
    return !exposure.hasPublicItems;
  }
  if (category === "exposed") {
    return exposure.hasPublicItems;
  }
  if (category === "needs-setup") {
    return resolveConnectorStatus(record).actionable;
  }
  if (category === "mcp") {
    return true;
  }
  return (record.catalogEntry.pluginPackage?.skills.length ?? 0) > 0;
}

function pluginContributorLabel(record: InstalledConnectorRecord): string {
  if (record.metadata.ownerScope === "organization") {
    return "Organization";
  }
  if (record.metadata.ownerUserId) {
    return "Member";
  }
  return "Personal";
}

function pluginKindLabel(record: InstalledConnectorRecord): string {
  return (record.catalogEntry.pluginPackage?.skills.length ?? 0) > 0
    ? "MCP + skills"
    : "MCP";
}

function sharedExposureTone(
  tone: ReturnType<typeof buildPluginSharedExposurePresentation>["sharedCloudTone"],
) {
  if (tone === "success") {
    return "success";
  }
  if (tone === "warning") {
    return "warning";
  }
  return "neutral";
}

function SharedEnvironmentDetail({
  organizationId,
  entry,
  onBack,
}: {
  organizationId: string;
  entry: SharedEnvironmentEntry;
  onBack: () => void;
}) {
  const {
    data: savedConfig,
    isLoading,
  } = useOrganizationCloudRepoConfig(
    organizationId,
    entry.gitOwner,
    entry.gitRepoName,
    true,
  );
  const draft = useCloudRepoConfigDraft({
    savedConfig,
    localSetupScript: "",
    localRunCommand: "",
    sourceKey: `shared:${organizationId}:${entry.key}`,
  });
  const saveMutation = useSaveOrganizationCloudRepoConfig();
  const authMutations = useAgentAuthMutations();
  const errorMessage = saveMutation.error?.message ?? null;
  const configured = savedConfig?.configured ?? false;
  const statusLabel = !draft.configured && configured
    ? "Will disable"
    : configured
      ? draft.dirty
        ? "Unsaved changes"
        : "Saved"
      : draft.configured
        ? "Not saved yet"
        : "Disabled";
  const isSaving = saveMutation.isPending
    || authMutations.isEnsuringProfile
    || authMutations.isEnablingProfileCloud;
  const saveDisabled = isLoading || isSaving || !draft.canSave;
  const revertDisabled = isSaving || !draft.dirty;

  async function handleSave() {
    const response = await saveMutation.mutateAsync({
      organizationId,
      gitOwner: entry.gitOwner,
      gitRepoName: entry.gitRepoName,
      configured: draft.savePayload.configured,
      defaultBranch: draft.savePayload.defaultBranch,
      envVars: draft.savePayload.envVars,
      setupScript: draft.savePayload.setupScript,
      runCommand: draft.savePayload.runCommand,
      files: draft.sharedEnvFilesDirty ? draft.sharedEnvFilePayloads : undefined,
    });
    const profile = await authMutations.ensureOrganizationProfile({ organizationId });
    await authMutations.enableProfileCloud({ sandboxProfileId: profile.id });
    draft.resetFromSavedConfig(response);
  }

  return (
    <section className="space-y-6">
      <div className="space-y-3">
        <Button type="button" variant="ghost" onClick={onBack}>
          Shared Sandbox
        </Button>
        <SettingsPageHeader
          title={entry.label}
          description="Configure the commands and environment values used when this repo runs in the shared cloud sandbox."
          action={<Badge>Admin</Badge>}
        />
      </div>

      <EnvironmentSection
        title="Shared cloud environment"
        icon={CloudIcon}
        description={`Saved to the organization sandbox for ${entry.label}.`}
        action={(
          <>
            <Badge tone={statusLabel === "Saved" ? "success" : "neutral"}>{statusLabel}</Badge>
            {configured && (
              <Button
                type="button"
                variant="outline"
                disabled={!draft.configured || isSaving}
                onClick={draft.disable}
              >
                {draft.configured ? "Disable shared cloud" : "Disable pending"}
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              disabled={revertDisabled}
              onClick={draft.revert}
            >
              Revert
            </Button>
            <Button
              type="button"
              loading={isSaving}
              disabled={saveDisabled}
              onClick={() => { void handleSave(); }}
            >
              {configured ? "Save" : "Enable shared cloud"}
            </Button>
          </>
        )}
      >
        {errorMessage ? (
          <p className="text-sm text-destructive">{errorMessage}</p>
        ) : null}

        <EnvironmentField
          label="Default branch"
          description="Branch used when shared automations or Slack sessions create new worktrees for this repo."
        >
          <Input
            value={draft.defaultBranch ?? ""}
            onChange={(event) => draft.setDefaultBranch(event.target.value)}
            placeholder="main"
            className="h-8 max-w-xl px-2.5 py-1.5 font-mono text-sm leading-[var(--readable-code-line-height)]"
          />
        </EnvironmentField>

        <RepoRunCommandCard
          runCommand={draft.runCommand}
          onChange={draft.setRunCommand}
        />

        <RepoSetupScriptCard
          setupScript={draft.setupScript}
          onChange={draft.setSetupScript}
        />

        <RepoEnvVarsCard
          rows={draft.envVarRows}
          onAddRow={draft.addEnvVarRow}
          onUpdateRow={draft.updateEnvVarRow}
          onRemoveRow={draft.removeEnvVarRow}
        />

        <RepoSharedEnvFilesCard
          files={draft.sharedEnvFiles}
          onAddFile={draft.addSharedEnvFile}
          onUpdateFilePath={draft.updateSharedEnvFilePath}
          onAddRow={draft.addSharedEnvFileRow}
          onUpdateRow={draft.updateSharedEnvFileRow}
          onRemoveRow={draft.removeSharedEnvFileRow}
          onRemoveFile={draft.removeSharedEnvFile}
        />
      </EnvironmentSection>
    </section>
  );
}

function SharedEnvironmentsShell({ children }: { children: ReactNode }) {
  return (
    <section className="space-y-6">
      <SettingsPageHeader
        title="Shared Sandbox"
        description="The runtime your team's shared work uses. The only page where this is configured."
        action={<Badge>Admin</Badge>}
      />
      {children}
    </section>
  );
}

function buildSharedEnvironmentEntries(
  repositories: SettingsRepositoryEntry[],
  configs: CloudRepoConfigSummary[],
): SharedEnvironmentEntry[] {
  const byKey = new Map<string, SharedEnvironmentEntry>();

  for (const repository of repositories) {
    if (!isCloudRepository(repository)) {
      continue;
    }
    const key = cloudRepositoryKey(repository.gitOwner, repository.gitRepoName);
    byKey.set(key, {
      key,
      gitOwner: repository.gitOwner,
      gitRepoName: repository.gitRepoName,
      label: `${repository.gitOwner}/${repository.gitRepoName}`,
      description: repository.secondaryLabel ?? repository.sourceRoot,
      configured: false,
      configuredAt: null,
      localRepository: repository,
    });
  }

  for (const config of configs) {
    const key = cloudRepositoryKey(config.gitOwner, config.gitRepoName);
    const existing = byKey.get(key);
    byKey.set(key, {
      key,
      gitOwner: config.gitOwner,
      gitRepoName: config.gitRepoName,
      label: `${config.gitOwner}/${config.gitRepoName}`,
      description: existing?.description ?? "Organization cloud repo",
      configured: config.configured,
      configuredAt: config.configuredAt,
      localRepository: existing?.localRepository ?? null,
    });
  }

  return [...byKey.values()].sort((left, right) =>
    left.label.localeCompare(right.label));
}
