import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Select } from "@/components/ui/Select";
import { SettingsCard } from "@/components/settings/shared/SettingsCard";
import { SettingsCardRow } from "@/components/settings/shared/SettingsCardRow";
import { SettingsPageHeader } from "@/components/settings/shared/SettingsPageHeader";
import { BotStatusSection } from "@/components/settings/panes/slack/BotStatusSection";
import { ChannelsSection } from "@/components/settings/panes/slack/ChannelsSection";
import { ConnectionSection } from "@/components/settings/panes/slack/ConnectionSection";
import { RepoRoutingSection } from "@/components/settings/panes/slack/RepoRoutingSection";
import { SessionDefaultsSection } from "@/components/settings/panes/slack/SessionDefaultsSection";
import { SharedReadinessSection } from "@/components/settings/panes/slack/SharedReadinessSection";
import { useAgentRunConfig } from "@/hooks/access/cloud/agent-run-configs/use-agent-run-configs";
import { useAgentRunConfigMutations } from "@/hooks/access/cloud/agent-run-configs/use-agent-run-config-mutations";
import { useCloudAgentCatalog } from "@/hooks/access/cloud/agent-catalog/use-cloud-agent-catalog";
import { useCloudTargets } from "@/hooks/access/cloud/targets/use-cloud-targets";
import { useIsAdmin } from "@/hooks/access/cloud/organizations/use-is-admin";
import { useSlackBotConfig } from "@/hooks/access/cloud/slack/use-slack-bot-config";
import { useSlackBotConfigMutations } from "@/hooks/access/cloud/slack/use-slack-bot-config-mutations";
import { useSlackChannels } from "@/hooks/access/cloud/slack/use-slack-channels";
import { useSlackConnection } from "@/hooks/access/cloud/slack/use-slack-connection";
import {
  useSlackRepoRoutingProfileMutation,
  useSlackRepoRoutingProfiles,
} from "@/hooks/access/cloud/slack/use-slack-repo-routing-profiles";
import { useTauriShellActions } from "@/hooks/access/tauri/use-shell-actions";
import { useActiveOrganization } from "@/hooks/organizations/facade/use-active-organization";
import {
  buildLaunchControlDescriptors,
} from "@/lib/domain/chat/models/launch-control-descriptors";
import type {
  LiveSessionControlDescriptor,
  SupportedLiveControlKey,
} from "@/lib/domain/chat/session-controls/session-controls";
import { buildSettingsHref } from "@/lib/domain/settings/navigation";
import type {
  DesktopAgentLaunchAgent,
  DesktopAgentLaunchModel,
} from "@/lib/domain/agents/cloud-launch-catalog";
import type {
  SlackChannel,
  SlackRepoRoutingProfile,
  UpdateSlackBotConfigRequest,
} from "@proliferate/cloud-sdk";

const EMPTY_AGENTS: DesktopAgentLaunchAgent[] = [];
const EMPTY_CHANNELS: SlackChannel[] = [];
const EMPTY_PROFILES: SlackRepoRoutingProfile[] = [];

interface SlackSessionDefaultsDraft {
  agentKind: string | null;
  modelId: string | null;
  controlValues: Record<string, string>;
}

export function SlackBotPane() {
  const navigate = useNavigate();
  const { openExternal } = useTauriShellActions();
  const [feedback, setFeedback] = useState<{ tone: "info" | "error"; message: string } | null>(null);
  const {
    activeOrganization,
    activeOrganizationId,
    organizations,
    organizationsQuery,
    setActiveOrganizationId,
  } = useActiveOrganization();
  const admin = useIsAdmin(activeOrganizationId);
  const canManage = admin.isAdmin;
  const canLoadSlack = Boolean(activeOrganizationId && canManage);
  const connectionQuery = useSlackConnection(activeOrganizationId, canLoadSlack);
  const configQuery = useSlackBotConfig(activeOrganizationId, canLoadSlack);
  const config = configQuery.data?.config ?? null;
  const connection = connectionQuery.connection ?? configQuery.data?.connection ?? null;
  const mutations = useSlackBotConfigMutations(activeOrganizationId);
  const channelsQuery = useSlackChannels(activeOrganizationId, canLoadSlack && Boolean(connection));
  const profilesQuery = useSlackRepoRoutingProfiles(
    activeOrganizationId,
    canLoadSlack && Boolean(connection),
  );
  const repoProfileMutation = useSlackRepoRoutingProfileMutation(activeOrganizationId);
  const agentCatalogQuery = useCloudAgentCatalog(canLoadSlack);
  const launchAgents = agentCatalogQuery.data?.agents ?? EMPTY_AGENTS;
  const selectedRunConfigQuery = useAgentRunConfig(
    config?.defaultAgentRunConfigId ?? null,
    canLoadSlack && Boolean(config?.defaultAgentRunConfigId),
  );
  const agentRunConfigMutations = useAgentRunConfigMutations();
  const targetsQuery = useCloudTargets(canLoadSlack);
  const [sessionDraft, setSessionDraft] = useState<SlackSessionDefaultsDraft>({
    agentKind: null,
    modelId: null,
    controlValues: {},
  });
  const selectedAgent = useMemo(
    () => resolveSlackLaunchAgent(launchAgents, sessionDraft.agentKind),
    [launchAgents, sessionDraft.agentKind],
  );
  const selectedModel = useMemo(
    () => resolveSlackLaunchModel(selectedAgent, sessionDraft.modelId),
    [selectedAgent, sessionDraft.modelId],
  );
  const sessionControls = useMemo(
    () => selectedAgent && selectedModel
      ? buildLaunchControlDescriptors({
        selection: { kind: selectedAgent.kind, modelId: selectedModel.id },
        launchAgents: [selectedAgent],
        pendingConfigChanges: null,
        preferences: {
          defaultSessionModeByAgentKind: sessionDraft.controlValues.mode
            ? { [selectedAgent.kind]: sessionDraft.controlValues.mode }
            : {},
          defaultLiveSessionControlValuesByAgentKind: {
            [selectedAgent.kind]: sessionDraft.controlValues,
          },
        },
        onSelect: (
          _agentKind: string,
          _controlKey: SupportedLiveControlKey,
          rawConfigId: string,
          value: string,
        ) => {
          setSessionDraft((current) => ({
            ...current,
            controlValues: {
              ...current.controlValues,
              [rawConfigId]: value,
            },
          }));
        },
      })
      : [],
    [selectedAgent, selectedModel, sessionDraft.controlValues],
  );
  const selectedSessionControlValues = useMemo(
    () => selectedControlValues(sessionControls),
    [sessionControls],
  );
  const savingSessionDefaults =
    mutations.updateMutation.isPending
    || agentRunConfigMutations.createMutation.isPending;

  useEffect(() => {
    if (
      !canLoadSlack
      || !config
      || launchAgents.length === 0
      || selectedRunConfigQuery.isLoading
    ) {
      return;
    }

    const selectedRunConfig = selectedRunConfigQuery.data ?? null;
    const nextAgent = resolveSlackLaunchAgent(
      launchAgents,
      selectedRunConfig?.agentKind ?? config.defaultAgentKind ?? null,
    );
    const nextModel = resolveSlackLaunchModel(
      nextAgent,
      selectedRunConfig?.modelId ?? null,
    );
    const nextDraft: SlackSessionDefaultsDraft = {
      agentKind: nextAgent?.kind ?? null,
      modelId: nextModel?.id ?? null,
      controlValues: stringControlValues(selectedRunConfig?.controlValues ?? {}),
    };
    setSessionDraft((current) =>
      slackSessionDraftsEqual(current, nextDraft) ? current : nextDraft
    );
  }, [
    canLoadSlack,
    config,
    launchAgents,
    selectedRunConfigQuery.data,
    selectedRunConfigQuery.isLoading,
  ]);

  useEffect(() => {
    if (!import.meta.env.DEV) {
      return;
    }
    console.debug("[agent-harness-config][slackbot]", {
      organizationId: activeOrganizationId,
      configuredRunConfigId: config?.defaultAgentRunConfigId ?? null,
      draft: sessionDraft,
      selectedAgent: selectedAgent?.kind ?? null,
      selectedModel: selectedModel?.id ?? null,
      catalogAgents: launchAgents.map((agent) => ({
        agentKind: agent.kind,
        modelCount: agent.models.length,
        launchControls: agent.launchControls.map((control) => control.key),
      })),
      renderedControls: sessionControls.map((control) => ({
        key: control.key,
        rawConfigId: control.rawConfigId,
        detail: control.detail,
        optionCount: control.options.length,
      })),
    });
  }, [
    activeOrganizationId,
    config?.defaultAgentRunConfigId,
    launchAgents,
    selectedAgent?.kind,
    selectedModel?.id,
    sessionControls,
    sessionDraft,
  ]);

  function updateConfig(body: UpdateSlackBotConfigRequest) {
    setFeedback(null);
    mutations.updateMutation.mutate(body, {
      onSuccess: () => setFeedback({ tone: "info", message: "Slack bot settings saved." }),
      onError: (error) => setFeedback({ tone: "error", message: error.message }),
    });
  }

  function validateConnection() {
    setFeedback(null);
    mutations.validateMutation.mutate(undefined, {
      onSuccess: () => setFeedback({ tone: "info", message: "Slack connection validated." }),
      onError: (error) => setFeedback({ tone: "error", message: error.message }),
    });
  }

  function disconnect() {
    setFeedback(null);
    mutations.disconnectMutation.mutate(undefined, {
      onSuccess: () => setFeedback({ tone: "info", message: "Slack disconnected." }),
      onError: (error) => setFeedback({ tone: "error", message: error.message }),
    });
  }

  function openOAuthStartUrl() {
    setFeedback(null);
    mutations.oauthStartMutation.mutate(undefined, {
      onSuccess: ({ authorizeUrl }) => {
        void openExternal(authorizeUrl);
      },
      onError: (error) => setFeedback({ tone: "error", message: error.message }),
    });
  }

  async function saveSessionDefaults() {
    setFeedback(null);
    if (!activeOrganizationId || !config || !selectedAgent || !selectedModel) {
      setFeedback({ tone: "error", message: "Choose an agent and model before saving Slack defaults." });
      return;
    }
    try {
      const runConfig = await agentRunConfigMutations.createMutation.mutateAsync({
        name: slackRunConfigName(selectedAgent.displayName),
        ownerScope: "organization",
        organizationId: activeOrganizationId,
        agentKind: selectedAgent.kind,
        modelId: selectedModel.id,
        controlValues: selectedSessionControlValues,
        usableInPersonalSandboxes: false,
        usableInSharedSandboxes: true,
      });
      await mutations.updateMutation.mutateAsync({
        defaultAgentKind: selectedAgent.kind,
        defaultAgentRunConfigId: runConfig.id,
      });
      setFeedback({ tone: "info", message: "Slack session defaults saved." });
    } catch (error) {
      setFeedback({
        tone: "error",
        message: error instanceof Error ? error.message : "Could not save Slack session defaults.",
      });
    }
  }

  if (organizationsQuery.isLoading) {
    return (
      <SlackBotShell>
        <SettingsCard>
          <div className="p-3 text-sm text-muted-foreground">Loading organizations...</div>
        </SettingsCard>
      </SlackBotShell>
    );
  }

  if (!activeOrganization) {
    return (
      <SlackBotShell>
        <SettingsCard>
          <div className="p-3 text-sm text-muted-foreground">
            Join or create an organization before configuring Slack.
          </div>
        </SettingsCard>
      </SlackBotShell>
    );
  }

  if (admin.isLoading) {
    return (
      <SlackBotShell>
        <OrganizationSelector
          organizationId={activeOrganizationId}
          organizations={organizations}
          onSelect={setActiveOrganizationId}
        />
        <SettingsCard>
          <div className="p-3 text-sm text-muted-foreground">Checking admin access...</div>
        </SettingsCard>
      </SlackBotShell>
    );
  }

  if (!canManage) {
    return (
      <SlackBotShell>
        <OrganizationSelector
          organizationId={activeOrganizationId}
          organizations={organizations}
          onSelect={setActiveOrganizationId}
        />
        <SettingsCard>
          <div className="space-y-1 p-3">
            <p className="text-sm font-medium text-foreground">Admin access required</p>
            <p className="text-sm text-muted-foreground">
              Slack bot settings are available to organization owners and admins.
            </p>
          </div>
        </SettingsCard>
      </SlackBotShell>
    );
  }

  return (
    <SlackBotShell>
      <OrganizationSelector
        organizationId={activeOrganizationId}
        organizations={organizations}
        onSelect={setActiveOrganizationId}
      />

      {feedback ? (
        <div className={feedback.tone === "error"
          ? "rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          : "rounded-lg border border-border bg-surface-elevated-secondary px-3 py-2 text-sm text-muted-foreground"}
        >
          {feedback.message}
        </div>
      ) : null}

      <ConnectionSection
        connection={connection}
        loading={connectionQuery.isLoading || configQuery.isLoading}
        canManage={canManage}
        opening={mutations.oauthStartMutation.isPending}
        disconnecting={mutations.disconnectMutation.isPending}
        onOpenOAuth={openOAuthStartUrl}
        onDisconnect={disconnect}
      />

      <BotStatusSection
        connection={connection}
        config={config}
        canManage={canManage}
        saving={mutations.updateMutation.isPending}
        validating={mutations.validateMutation.isPending}
        onUpdateConfig={updateConfig}
        onValidate={validateConnection}
      />

      <SessionDefaultsSection
        config={config}
        agents={launchAgents}
        selectedAgent={selectedAgent}
        selectedModel={selectedModel}
        controls={sessionControls}
        loading={agentCatalogQuery.isLoading || selectedRunConfigQuery.isLoading}
        canManage={canManage}
        saving={savingSessionDefaults}
        onSelectModel={(agentKind, modelId) => {
          setSessionDraft(() => ({
            agentKind,
            modelId,
            controlValues: {},
          }));
        }}
        onSave={saveSessionDefaults}
      />

      <RepoRoutingSection
        config={config}
        profiles={profilesQuery.data?.profiles ?? EMPTY_PROFILES}
        loadingProfiles={profilesQuery.isLoading}
        canManage={canManage}
        saving={mutations.updateMutation.isPending}
        savingProfileId={repoProfileMutation.isPending
          ? repoProfileMutation.variables?.profileId ?? null
          : null}
        onUpdateConfig={updateConfig}
        onUpdateProfile={(body) => {
          setFeedback(null);
          repoProfileMutation.mutate(
            { profileId: body.cloudRepoConfigId, body },
            {
              onSuccess: () =>
                setFeedback({ tone: "info", message: "Repo routing profile saved." }),
              onError: (error) =>
                setFeedback({ tone: "error", message: error.message }),
            },
          );
        }}
      />

      <ChannelsSection
        config={config}
        channels={channelsQuery.data?.channels ?? EMPTY_CHANNELS}
        loadingChannels={channelsQuery.isLoading}
        canManage={canManage}
        saving={mutations.updateMutation.isPending}
        onUpdateConfig={updateConfig}
      />

      <SharedReadinessSection
        loadingTargets={targetsQuery.isLoading}
        targetCount={targetsQuery.data?.length ?? 0}
        onOpenCompute={() => navigate(buildSettingsHref({ section: "compute" }))}
      />
    </SlackBotShell>
  );
}

function resolveSlackLaunchAgent(
  agents: DesktopAgentLaunchAgent[],
  agentKind: string | null,
): DesktopAgentLaunchAgent | null {
  return agents.find((agent) => agent.kind === agentKind)
    ?? agents.find((agent) => agent.models.length > 0)
    ?? null;
}

function resolveSlackLaunchModel(
  agent: DesktopAgentLaunchAgent | null,
  modelId: string | null,
): DesktopAgentLaunchModel | null {
  if (!agent) {
    return null;
  }
  return agent.models.find((model) => model.id === modelId)
    ?? agent.models.find((model) => model.id === agent.defaultModelId)
    ?? agent.models.find((model) => model.isDefault)
    ?? agent.models[0]
    ?? null;
}

function selectedControlValues(
  controls: LiveSessionControlDescriptor[],
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const control of controls) {
    const selected = control.options.find((option) => option.selected);
    if (selected?.value) {
      values[control.rawConfigId] = selected.value;
    }
  }
  return values;
}

function stringControlValues(values: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(values).flatMap(([key, value]) =>
      typeof value === "string" && value.trim().length > 0
        ? [[key, value]]
        : []
    ),
  );
}

function slackSessionDraftsEqual(
  left: SlackSessionDefaultsDraft,
  right: SlackSessionDefaultsDraft,
): boolean {
  return left.agentKind === right.agentKind
    && left.modelId === right.modelId
    && controlValuesEqual(left.controlValues, right.controlValues);
}

function controlValuesEqual(
  left: Record<string, string>,
  right: Record<string, string>,
): boolean {
  const leftEntries = Object.entries(left).filter(([, value]) => value.trim().length > 0);
  const rightEntries = Object.entries(right).filter(([, value]) => value.trim().length > 0);
  if (leftEntries.length !== rightEntries.length) {
    return false;
  }
  return leftEntries.every(([key, value]) => right[key] === value);
}

function slackRunConfigName(agentDisplayName: string): string {
  return `Slack bot - ${agentDisplayName}`;
}

function SlackBotShell({ children }: { children: ReactNode }) {
  return (
    <section className="space-y-6">
      <SettingsPageHeader
        title="Slack bot"
        description="Install and configure Slack as a team automation entrypoint."
      />
      {children}
    </section>
  );
}

function OrganizationSelector({
  organizationId,
  organizations,
  onSelect,
}: {
  organizationId: string | null;
  organizations: Array<{ id: string; name: string }>;
  onSelect: (organizationId: string | null) => void;
}) {
  if (organizations.length <= 1) {
    return null;
  }

  return (
    <SettingsCard>
      <SettingsCardRow
        label="Active organization"
        description="Slack bot configuration is scoped to one organization."
      >
        <Select
          value={organizationId ?? ""}
          aria-label="Active organization"
          className="min-w-48"
          onChange={(event) => onSelect(event.currentTarget.value || null)}
        >
          {organizations.map((organization) => (
            <option key={organization.id} value={organization.id}>
              {organization.name}
            </option>
          ))}
        </Select>
      </SettingsCardRow>
    </SettingsCard>
  );
}
