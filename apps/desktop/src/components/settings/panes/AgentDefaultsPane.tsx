import type { AgentSummary, ReconcileAgentResult } from "@anyharness/sdk";
import { Button } from "@proliferate/ui/primitives/Button";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { AgentSetupModal } from "@/components/agents/AgentSetupModal";
import { LoadingState } from "@/components/feedback/LoadingIllustration";
import { ModelRegistryPane } from "@/components/settings/panes/ModelRegistryPane";
import { AgentHarnessConfigComposer } from "@/components/settings/shared/AgentHarnessConfigComposer";
import { SettingsCard } from "@/components/settings/shared/SettingsCard";
import { SettingsCardRow } from "@/components/settings/shared/SettingsCardRow";
import { SettingsPageHeader } from "@/components/settings/shared/SettingsPageHeader";
import { Badge, type BadgeTone } from "@proliferate/ui/primitives/Badge";
import { ProviderIcon } from "@proliferate/ui/provider-icons";
import { SettingsMenu } from "@proliferate/ui/primitives/SettingsMenu";
import { useCloudAgentCatalog } from "@/hooks/access/cloud/agent-catalog/use-cloud-agent-catalog";
import { useModelRegistrySettings } from "@/hooks/settings/workflows/use-model-registry-settings";
import {
  mergeRuntimeLaunchOptionsIntoDesktopLaunchAgents,
  type DesktopAgentLaunchAgent,
} from "@/lib/domain/agents/cloud-launch-catalog";
import { withUpdatedDefaultModelIdByAgentKind } from "@/lib/domain/agents/model-options";
import { withUpdatedModelVisibilityOverride } from "@/lib/domain/chat/models/model-visibility";
import {
  buildLaunchControlDescriptors,
} from "@/lib/domain/chat/models/launch-control-descriptors";
import { withUpdatedDefaultSessionModeByAgentKind } from "@/lib/domain/chat/session-controls/session-mode-control";
import type {
  SupportedLiveControlKey,
} from "@/lib/domain/chat/session-controls/session-controls";
import type {
  DefaultLiveSessionControlKey,
} from "@/lib/domain/preferences/user/session-defaults";
import {
  getAgentStatusDisplay,
  type AgentStatusTone,
} from "@/lib/domain/agents/status-presentation";
import { buildSettingsHref } from "@/lib/domain/settings/navigation";
import type { SettingsAgentDefaultRow } from "@/lib/domain/settings/agent-defaults";
import {
  withUpdatedDefaultLiveSessionControlValueByAgentKind,
} from "@/lib/domain/settings/agent-defaults";
import { buildPrimaryHarnessPreferenceUpdate } from "@/lib/domain/settings/chat-defaults";

export function AgentDefaultsPane() {
  const navigate = useNavigate();
  const [setupAgent, setSetupAgent] = useState<AgentSummary | null>(null);
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
    refreshModelRegistry,
    preferences,
    agentDefaultRows,
    orderedAgentDefaultRows,
    primaryHarnessLabel,
    reconcileResultsByKind,
  } = useModelRegistrySettings();
  const cloudAgentCatalogQuery = useCloudAgentCatalog(connectionState !== "failed");
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

  return (
    <section className="space-y-5">
      <SettingsPageHeader
        title="Agent Defaults"
        description="Configure how each agent harness launches by default. Authentication lives in Agent Authentication."
      />

      <AgentDefaultsSection title="Default harness">
        <SettingsCard>
          {connectionState === "connecting" ? (
            <div className="p-3">
              <LoadingState
                message="Connecting"
                subtext="Waiting for the runtime before loading agent defaults..."
              />
            </div>
          ) : connectionState === "failed" ? (
            <div className="space-y-1 p-3">
              <p className="text-sm font-medium text-foreground">Agent defaults are unavailable</p>
              <p className="text-sm text-muted-foreground">
                {runtimeError ?? "Reconnect the runtime to edit launch defaults."}
              </p>
            </div>
          ) : ((agentsLoading || modelRegistriesLoading || runtimeLaunchOptions.isLoading) && (agents.length === 0 || modelRegistries.length === 0)) ? (
            <div className="p-3">
              <LoadingState
                message="Loading agent defaults"
                subtext="Fetching available agents and model registries..."
              />
            </div>
          ) : agentDefaultRows.length === 0 ? (
            <div className="space-y-1 p-3">
              <p className="text-sm font-medium text-foreground">No agent defaults are available</p>
              <p className="text-sm text-muted-foreground">
                Install and configure a harness before editing launch defaults.
              </p>
            </div>
          ) : (
            <SettingsCardRow
              label="Harness"
              description="Launch identity for new chats"
            >
              <SettingsMenu
                label={primaryHarnessLabel}
                className="w-56"
                menuClassName="w-64"
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
            </SettingsCardRow>
          )}
        </SettingsCard>
      </AgentDefaultsSection>

      {connectionState !== "failed" && orderedAgentDefaultRows.map((row) => (
        <AgentDefaultsSection key={row.kind} title={`${row.displayName} defaults`}>
          <div className="space-y-2">
            <AgentDefaultComposer
              row={row}
              launchAgent={launchAgents.find((agent) => agent.kind === row.kind) ?? null}
              preferences={preferences}
            />

            {row.visibilityModels.length > 0 ? (
              <ModelRegistryPane
                agentKind={row.kind}
                models={row.visibilityModels}
                refreshable={row.kind === "cursor" || row.kind === "opencode"}
                refreshing={refreshModelRegistry.isPending}
                onRefresh={() => {
                  refreshModelRegistry.mutate({
                    kind: row.kind,
                    request: { forceProviderRefresh: false },
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
        </AgentDefaultsSection>
      ))}

      {connectionState !== "failed" && agentsNeedingSetup.length > 0 ? (
        <AgentConfigurationIssuesSection
          agents={agentsNeedingSetup}
          agentsLoading={agentsLoading}
          isReconciling={isReconciling}
          reconcileResultsByKind={reconcileResultsByKind}
          onOpenAuthentication={(agentKind) => {
            navigate(buildSettingsHref({
              section: "agent-authentication",
              kind: agentKind,
            }));
          }}
          onReviewSetup={setSetupAgent}
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

function AgentConfigurationIssuesSection({
  agents,
  agentsLoading,
  isReconciling,
  reconcileResultsByKind,
  onOpenAuthentication,
  onReviewSetup,
}: {
  agents: AgentSummary[];
  agentsLoading: boolean;
  isReconciling: boolean;
  reconcileResultsByKind: Map<string, ReconcileAgentResult>;
  onOpenAuthentication: (agentKind: string) => void;
  onReviewSetup: (agent: AgentSummary) => void;
}) {
  return (
    <AgentDefaultsSection
      title="Needs configuration"
      description="These harnesses are installed or known, but cannot be used as launch defaults yet."
    >
      <SettingsCard>
        {agentsLoading ? (
          <div className="p-3">
            <LoadingState
              message="Checking agent configuration"
              subtext="Refreshing harness readiness..."
            />
          </div>
        ) : agents.map((agent) => {
          const reconcileResult = reconcileResultsByKind.get(agent.kind);
          const status = getAgentStatusDisplay(agent, {
            reconcileResult,
            isReconciling,
          });
          const usesAuthenticationPage = agent.readiness === "credentials_required"
            || agent.readiness === "login_required";

          return (
            <div
              key={agent.kind}
              className="flex items-start gap-3 border-b border-border/60 px-3 py-3 last:border-b-0"
            >
              <span className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-foreground/5 text-muted-foreground">
                <ProviderIcon kind={agent.kind} className="size-4" />
              </span>

              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-medium text-foreground">
                    {agent.displayName}
                  </span>
                  <Badge tone={badgeToneForAgentStatus(status.tone)}>
                    {status.label}
                  </Badge>
                </div>
                <p className="text-sm leading-5 text-muted-foreground">
                  {configurationDetailForAgent(agent, reconcileResult)}
                </p>
                {agent.expectedEnvVars.length > 0 ? (
                  <p className="text-xs text-muted-foreground/80">
                    Expected credentials: {agent.expectedEnvVars.join(", ")}
                  </p>
                ) : null}
              </div>

              <Button
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={() => {
                  if (usesAuthenticationPage) {
                    onOpenAuthentication(agent.kind);
                    return;
                  }
                  onReviewSetup(agent);
                }}
              >
                {usesAuthenticationPage ? "Open auth" : "Review setup"}
              </Button>
            </div>
          );
        })}
      </SettingsCard>
    </AgentDefaultsSection>
  );
}

function badgeToneForAgentStatus(tone: AgentStatusTone): BadgeTone {
  if (tone === "success") return "success";
  if (tone === "warning") return "warning";
  if (tone === "destructive") return "destructive";
  return "neutral";
}

function configurationDetailForAgent(
  agent: AgentSummary,
  reconcileResult?: ReconcileAgentResult,
): string {
  if (reconcileResult?.outcome === "failed" && reconcileResult.message?.trim()) {
    return reconcileResult.message;
  }
  if (agent.message?.trim()) {
    return agent.message;
  }
  if (agent.readiness === "credentials_required") {
    return "Add or select credentials in Agent Authentication before using this harness as a default.";
  }
  if (agent.readiness === "login_required") {
    return "Complete authentication in Agent Authentication before using this harness as a default.";
  }
  if (agent.readiness === "install_required") {
    return "The managed harness install has not completed yet.";
  }
  if (agent.readiness === "error") {
    return "Review setup details, then refresh the runtime once the issue is fixed.";
  }
  return "This harness is not ready to use as a launch default.";
}

function AgentDefaultComposer({
  row,
  launchAgent,
  preferences,
}: {
  row: SettingsAgentDefaultRow;
  launchAgent: DesktopAgentLaunchAgent | null;
  preferences: ReturnType<typeof useModelRegistrySettings>["preferences"];
}) {
  const controls = useMemo(
    () => launchAgent
      ? buildLaunchControlDescriptors({
        selection: { kind: row.kind, modelId: row.selectedModel.id },
        launchAgents: [launchAgent],
        pendingConfigChanges: null,
        preferences,
        onSelect: (
          _agentKind: string,
          controlKey: SupportedLiveControlKey,
          _rawConfigId: string,
          value: string,
        ) => {
          if (controlKey === "mode") {
            preferences.set(
              "defaultSessionModeByAgentKind",
              withUpdatedDefaultSessionModeByAgentKind(
                preferences.defaultSessionModeByAgentKind,
                row.kind,
                value,
              ),
            );
            return;
          }
          if (isDefaultLiveSessionControlKey(controlKey)) {
            preferences.set(
              "defaultLiveSessionControlValuesByAgentKind",
              withUpdatedDefaultLiveSessionControlValueByAgentKind(
                preferences.defaultLiveSessionControlValuesByAgentKind,
                row.kind,
                controlKey,
                value,
              ),
            );
          }
        },
      })
      : [],
    [launchAgent, preferences, row.kind, row.selectedModel.id],
  );

  useEffect(() => {
    if (!import.meta.env.DEV) {
      return;
    }
    console.debug("[agent-harness-config][agent-default]", {
      agentKind: row.kind,
      modelId: row.selectedModel.id,
      catalogControls: launchAgent?.launchControls.map((control) => ({
        key: control.key,
        createField: control.createField,
        phase: control.phase,
        surfaces: control.surfaces,
      })) ?? [],
      renderedControls: controls.map((control) => ({
        key: control.key,
        rawConfigId: control.rawConfigId,
        detail: control.detail,
        optionCount: control.options.length,
      })),
    });
  }, [controls, launchAgent, row.kind, row.selectedModel.id]);

  return (
    <AgentHarnessConfigComposer
      agentKind={row.kind}
      agentDisplayName={row.displayName}
      selectedModelId={row.selectedModel.id}
      selectedModelLabel={row.selectedModel.displayName}
      modelGroups={[{
        agentKind: row.kind,
        agentDisplayName: row.displayName,
        models: row.models.map((model) => ({
          id: model.id,
          label: model.displayName,
          detail: model.description ?? model.id,
        })),
      }]}
      controls={controls}
      placeholder="Describe a task"
      onSelectModel={(_agentKind, modelId) => {
        preferences.set(
          "defaultChatModelIdByAgentKind",
          withUpdatedDefaultModelIdByAgentKind(
            preferences.defaultChatModelIdByAgentKind,
            row.kind,
            modelId,
          ),
        );
      }}
    />
  );
}

function isDefaultLiveSessionControlKey(
  key: SupportedLiveControlKey,
): key is DefaultLiveSessionControlKey {
  return key === "collaboration_mode"
    || key === "reasoning"
    || key === "effort"
    || key === "fast_mode";
}

function AgentDefaultsSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="space-y-0.5">
        <h2 className="text-sm font-medium text-foreground">{title}</h2>
        {description ? (
          <p className="text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {children}
    </div>
  );
}
