import type { AgentSummary } from "@anyharness/sdk";
import { Button } from "@proliferate/ui/primitives/Button";
import { RefreshCw } from "@proliferate/ui/icons";
import { useEffect, useMemo, useState } from "react";
import { AgentSetupModal } from "@/components/agents/AgentSetupModal";
import { AgentDefaultComposer } from "@/components/settings/panes/AgentDefaultComposer";
import { ModelRegistryPane } from "@/components/settings/panes/ModelRegistryPane";
import {
  AgentConfigurationIssuesSection,
  type AgentConfigurationIssueAction,
} from "@/components/settings/panes/agent-defaults/AgentConfigurationIssuesSection";
import { SettingsRow, SETTINGS_CONTROL_WIDTH_CLASS } from "@proliferate/product-ui/settings/SettingsRow";
import { SettingsSection } from "@proliferate/product-ui/settings/SettingsSection";
import { SettingsEmptyState } from "@proliferate/product-ui/settings/SettingsEmptyState";
import { AgentAuthenticationSection } from "@/components/settings/panes/agent-auth/AgentAuthenticationSection";
import { SettingsPageHeader } from "@proliferate/product-ui/settings/SettingsPageHeader";
import { ProviderIcon } from "@proliferate/ui/provider-icons";
import { SettingsMenu } from "@proliferate/ui/primitives/SettingsMenu";
import { AGENT_SETUP_COPY } from "@/copy/agents/agents-copy";
import { useCloudAgentCatalog } from "@/hooks/access/cloud/agent-catalog/use-cloud-agent-catalog";
import { useAgentLoginTerminalWorkflow } from "@/hooks/agents/workflows/use-agent-login-terminal-workflow";
import { useAgentInstallationActions } from "@/hooks/agents/workflows/use-agent-installation-actions";
import { useModelRegistrySettings } from "@/hooks/settings/workflows/use-model-registry-settings";
import {
  mergeRuntimeLaunchOptionsIntoDesktopLaunchAgents,
} from "@/lib/domain/agents/cloud-launch-catalog";
import { withUpdatedDefaultModelIdByAgentKind } from "@/lib/domain/agents/model-options";
import { withUpdatedModelVisibilityOverride } from "@/lib/domain/chat/models/model-visibility";
import { isReadyAgent } from "@/lib/domain/agents/status";
import { useToastStore } from "@/stores/toast/toast-store";
import { buildPrimaryHarnessPreferenceUpdate } from "@/lib/domain/settings/chat-defaults";

export function AgentDefaultsPane() {
  const [setupAgent, setSetupAgent] = useState<AgentSummary | null>(null);
  const showToast = useToastStore((state) => state.show);
  const authTerminalWorkflow = useAgentLoginTerminalWorkflow();
  const { reconcileAgents } = useAgentInstallationActions();
  const {
    connectionState,
    runtimeError,
    agents,
    agentsNeedingSetup,
    agentsLoading,
    isReconciling,
    modelRegistries,
    modelRegistriesLoading,
    runtimeLaunchOptions,
    preferences,
    agentDefaultRows,
    orderedAgentDefaultRows,
    primaryHarnessLabel,
    reconcileResultsByKind,
  } = useModelRegistrySettings();
  const cloudAgentCatalogQuery = useCloudAgentCatalog(connectionState !== "failed");
  const canUpdateLocalInstalls = connectionState === "healthy" && !isReconciling;
  const launchAgents = useMemo(
    () => mergeRuntimeLaunchOptionsIntoDesktopLaunchAgents(
      cloudAgentCatalogQuery.data?.agents ?? [],
      runtimeLaunchOptions.data?.agents ?? null,
      { includeCloudOnlyAgents: true },
    ),
    [cloudAgentCatalogQuery.data?.agents, runtimeLaunchOptions.data?.agents],
  );

  useEffect(() => {
    if (!import.meta.env.DEV) {
      return;
    }
    console.debug("[agent-harness-config][agent-defaults]", {
      rows: orderedAgentDefaultRows.map((row) => ({
        agentKind: row.kind,
        modelId: row.selectedModel.id,
      })),
      launchAgents: launchAgents.map((agent) => ({
        agentKind: agent.kind,
        modelCount: agent.models.length,
        launchControls: agent.launchControls.map((control) => control.key),
      })),
    });
  }, [launchAgents, orderedAgentDefaultRows]);

  useEffect(() => {
    const sessions = authTerminalWorkflow.sessionsByKind;
    for (const session of Object.values(sessions)) {
      if (!session.terminal) {
        continue;
      }
      const agent = agents.find((candidate) => candidate.kind === session.kind);
      if (!agent || !isReadyAgent(agent)) {
        continue;
      }
      showToast(`${agent.displayName} is ready.`);
      void authTerminalWorkflow.closeAuthTerminal(session.kind);
    }
  }, [
    agents,
    authTerminalWorkflow.closeAuthTerminal,
    authTerminalWorkflow.sessionsByKind,
    showToast,
  ]);

  const handleUpdateLocalInstalls = () => {
    // Update the agents already installed on this machine to the catalog pins.
    // installed_only: missing agents install on demand at session start, not here.
    void reconcileAgents({ reinstall: true, installedOnly: true })
      .then(() => {
        showToast(AGENT_SETUP_COPY.updateInstallsStarted);
      })
      .catch((error) => {
        showToast(error instanceof Error ? error.message : String(error));
      });
  };
  const configurationIssueActionsByAgentKind = useMemo<Record<string, AgentConfigurationIssueAction>>(() => {
    const actions: Record<string, AgentConfigurationIssueAction> = {};

    for (const agent of agentsNeedingSetup) {
      const authTerminalSession = authTerminalWorkflow.sessionsByKind[agent.kind] ?? null;
      const canOpenInlineAuth = agent.readiness === "login_required"
        && agent.supportsLogin;
      const authActionLabel = authTerminalSession?.isStarting
        ? "Opening…"
        : authTerminalSession?.terminal
          ? "Restart auth"
          : authTerminalSession?.errorMessage
            ? "Retry auth"
            : "Open auth";

      actions[agent.kind] = {
        label: canOpenInlineAuth ? authActionLabel : "Review setup",
        loading: authTerminalSession?.isStarting ?? false,
        onClick: () => {
          if (canOpenInlineAuth) {
            void authTerminalWorkflow.openAuthTerminal(agent, {
              restart: Boolean(authTerminalSession),
            });
            return;
          }
          setSetupAgent(agent);
        },
      };
    }

    return actions;
  }, [
    agentsNeedingSetup,
    authTerminalWorkflow.openAuthTerminal,
    authTerminalWorkflow.sessionsByKind,
  ]);

  return (
    <section className="space-y-6">
      <SettingsPageHeader
        title="Agent defaults"
        description="Defaults for how new chats launch each agent."
        action={
          <Button
            variant="secondary"
            size="sm"
            type="button"
            disabled={!canUpdateLocalInstalls}
            onClick={handleUpdateLocalInstalls}
            className="gap-2"
          >
            <RefreshCw className={`size-3.5 ${isReconciling ? "animate-spin" : ""}`} />
            {isReconciling
              ? AGENT_SETUP_COPY.updatingInstalls
              : AGENT_SETUP_COPY.updateInstalls}
          </Button>
        }
      />

      <SettingsSection title="Default agent">
          {connectionState === "connecting" ? (
            <div className="text-ui-sm text-muted-foreground">Waiting for the runtime…</div>
          ) : connectionState === "failed" ? (
            <SettingsEmptyState
              size="compact"
              title="Could not load agent defaults"
              description={runtimeError ?? "Reconnect the runtime to edit launch defaults."}
            />
          ) : ((agentsLoading || modelRegistriesLoading || runtimeLaunchOptions.isLoading) && (agents.length === 0 || modelRegistries.length === 0)) ? (
            <div className="text-ui-sm text-muted-foreground">Loading agent defaults…</div>
          ) : agentDefaultRows.length === 0 ? (
            <SettingsEmptyState
              size="compact"
              title="No agent defaults yet"
              description="Install and configure an agent before editing launch defaults."
            />
          ) : (
            <SettingsRow
              label="Agent"
              description="Launch identity for new chats"
            >
              <SettingsMenu
                label={primaryHarnessLabel}
                className={SETTINGS_CONTROL_WIDTH_CLASS}
                menuClassName={SETTINGS_CONTROL_WIDTH_CLASS}
                groups={[{
                  id: "harnesses",
                  options: agentDefaultRows.map((row) => ({
                    id: row.kind,
                    label: row.displayName,
                    icon: <ProviderIcon kind={row.kind} className="size-3.5" />,
                    selected: row.isPrimary,
                    onSelect: () => {
                      const registry = modelRegistries.find((candidate) => candidate.kind === row.kind);
                      if (!registry) return;
                      preferences.setMultiple(
                        buildPrimaryHarnessPreferenceUpdate(preferences, registry),
                      );
                    },
                  })),
                }]}
              />
            </SettingsRow>
          )}
      </SettingsSection>

      {connectionState !== "failed" && orderedAgentDefaultRows.map((row) => (
        <SettingsSection key={row.kind} title={`${row.displayName} defaults`}>
          <div className="space-y-2">
            <AgentDefaultComposer
              row={row}
              launchAgent={launchAgents.find((agent) => agent.kind === row.kind) ?? null}
              preferences={preferences}
            />

            <AgentAuthenticationSection
              agentKind={row.kind}
              displayName={row.displayName}
            />

            {row.visibilityModels.length > 0 ? (
              <ModelRegistryPane
                agentKind={row.kind}
                models={row.visibilityModels}
                refreshable={row.kind === "cursor" || row.kind === "opencode"}
                refreshing={runtimeLaunchOptions.isRefetching}
                onRefresh={() => {
                  void runtimeLaunchOptions.refetch().then((result) => {
                    if (result.error) {
                      showToast(
                        result.error instanceof Error
                          ? result.error.message
                          : `Could not refresh ${row.displayName} models.`,
                      );
                    }
                  });
                }}
                onVisibilityChange={(modelId, visible, catalogDefaultOptIn) => {
                  if (!visible) {
                    const visibleRows = row.visibilityModels.filter((model) => model.isVisible);
                    if (visibleRows.length <= 1 && visibleRows.some((model) => model.id === modelId)) {
                      return;
                    }
                  }

                  const nextVisibilityOverrides = withUpdatedModelVisibilityOverride(
                    preferences.chatModelVisibilityOverridesByAgentKind,
                    row.kind,
                    modelId,
                    visible,
                    catalogDefaultOptIn,
                  );
                  const nextVisibleModel = row.visibilityModels.find((model) =>
                    model.id !== modelId && model.isVisible
                  ) ?? null;
                  const nextDefaultModelIds =
                    !visible && row.selectedModel.id === modelId && nextVisibleModel
                      ? withUpdatedDefaultModelIdByAgentKind(
                        preferences.defaultChatModelIdByAgentKind,
                        row.kind,
                        nextVisibleModel.id,
                      )
                      : preferences.defaultChatModelIdByAgentKind;

                  preferences.setMultiple({
                    chatModelVisibilityOverridesByAgentKind: nextVisibilityOverrides,
                    defaultChatModelIdByAgentKind: nextDefaultModelIds,
                  });
                }}
              />
            ) : null}
          </div>
        </SettingsSection>
      ))}

      {connectionState !== "failed" && agentsNeedingSetup.length > 0 ? (
        <AgentConfigurationIssuesSection
          agents={agentsNeedingSetup}
          agentsLoading={agentsLoading}
          isReconciling={isReconciling}
          reconcileResultsByKind={reconcileResultsByKind}
          issueActionsByAgentKind={configurationIssueActionsByAgentKind}
          authTerminalSessionsByKind={authTerminalWorkflow.sessionsByKind}
          authTerminalConnection={authTerminalWorkflow.runtimeConnection}
          onCloseAuthTerminal={(kind) => {
            void authTerminalWorkflow.closeAuthTerminal(kind);
          }}
          onAuthTerminalExit={(kind, code) => {
            void authTerminalWorkflow.handleTerminalExit(kind, code);
          }}
          onRestartAuthTerminal={(agent) => {
            void authTerminalWorkflow.openAuthTerminal(agent, { restart: true });
          }}
        />
      ) : null}

      {setupAgent ? (
        <AgentSetupModal
          agent={setupAgent}
          onClose={() => setSetupAgent(null)}
          reconcileState={isReconciling ? "reconciling" : "idle"}
          reconcileResult={reconcileResultsByKind.get(setupAgent.kind)}
        />
      ) : null}
    </section>
  );
}
