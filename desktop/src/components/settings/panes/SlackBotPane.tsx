import { useState, type ReactNode } from "react";
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
import { useAgentRunConfigs } from "@/hooks/access/cloud/agent-run-configs/use-agent-run-configs";
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
import { buildSettingsHref } from "@/lib/domain/settings/navigation";
import type {
  CloudAgentRunConfig,
  SlackChannel,
  SlackRepoRoutingProfile,
  UpdateSlackBotConfigRequest,
} from "@proliferate/cloud-sdk";

const EMPTY_AGENT_OPTIONS: Array<{ kind: string; displayName: string }> = [];
const EMPTY_AGENT_CONFIGS: CloudAgentRunConfig[] = [];
const EMPTY_CHANNELS: SlackChannel[] = [];
const EMPTY_PROFILES: SlackRepoRoutingProfile[] = [];

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
  const agentOptions = agentCatalogQuery.data?.agents.map((agent) => ({
    kind: agent.kind,
    displayName: agent.displayName,
  })) ?? EMPTY_AGENT_OPTIONS;
  const selectedAgentKind = config?.defaultAgentKind ?? agentOptions[0]?.kind ?? "claude";
  const agentRunConfigsQuery = useAgentRunConfigs({
    ownerScope: "organization",
    organizationId: activeOrganizationId,
    agentKind: selectedAgentKind,
    usableIn: "shared_sandboxes",
    status: "active",
  }, canLoadSlack && Boolean(config));
  const targetsQuery = useCloudTargets(canLoadSlack);

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
        agentOptions={agentOptions}
        agentRunConfigs={agentRunConfigsQuery.data?.configs ?? EMPTY_AGENT_CONFIGS}
        loadingConfigs={agentRunConfigsQuery.isLoading || agentCatalogQuery.isLoading}
        canManage={canManage}
        saving={mutations.updateMutation.isPending}
        onUpdateConfig={updateConfig}
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
