import { type ReactNode } from "react";
import { LoadingState } from "@/components/feedback/LoadingIllustration";
import { ModelRegistryPane } from "@/components/settings/panes/ModelRegistryPane";
import { SettingsCard } from "@/components/settings/shared/SettingsCard";
import { SettingsCardRow } from "@/components/settings/shared/SettingsCardRow";
import { SettingsPageHeader } from "@/components/settings/shared/SettingsPageHeader";
import { ProviderIcon } from "@/components/ui/provider-icons";
import { SettingsMenu } from "@/components/ui/SettingsMenu";
import { useModelRegistrySettings } from "@/hooks/settings/workflows/use-model-registry-settings";
import { withUpdatedDefaultModelIdByAgentKind } from "@/lib/domain/agents/model-options";
import { withUpdatedModelVisibilityOverride } from "@/lib/domain/chat/models/model-visibility";
import { withUpdatedDefaultSessionModeByAgentKind } from "@/lib/domain/chat/session-controls/session-mode-control";
import {
  withUpdatedDefaultLiveSessionControlValueByAgentKind,
} from "@/lib/domain/settings/agent-defaults";
import { buildPrimaryHarnessPreferenceUpdate } from "@/lib/domain/settings/chat-defaults";

export function AgentDefaultsPane() {
  const {
    connectionState,
    runtimeError,
    agents,
    agentsLoading,
    modelRegistries,
    modelRegistriesLoading,
    runtimeLaunchOptions,
    refreshModelRegistry,
    preferences,
    agentDefaultRows,
    orderedAgentDefaultRows,
    primaryHarnessLabel,
  } = useModelRegistrySettings();

  return (
    <section className="space-y-5">
      <SettingsPageHeader title="Agent Defaults" />

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
          <SettingsCard>
            <SettingsCardRow
              label="Model"
              description={row.isPrimary ? "Default model for the primary harness" : "Default model for this harness"}
            >
              <SettingsMenu
                label={row.selectedModel.displayName}
                className="w-60"
                menuClassName="w-72"
                groups={[{
                  id: `${row.kind}-models`,
                  options: row.models.map((model) => ({
                    id: model.id,
                    label: model.displayName,
                    icon: <ProviderIcon kind={row.kind} className="size-3.5" />,
                    selected: model.id === row.selectedModel.id,
                    onSelect: () => {
                      preferences.set(
                        "defaultChatModelIdByAgentKind",
                        withUpdatedDefaultModelIdByAgentKind(
                          preferences.defaultChatModelIdByAgentKind,
                          row.kind,
                          model.id,
                        ),
                      );
                    },
                  })),
                }]}
              />
            </SettingsCardRow>

            {row.modeOptions.length > 0 && row.selectedMode ? (
              <SettingsCardRow
                label="Permissions"
                description={row.isPrimary ? "Permission mode for the primary harness" : "Permission mode for this harness"}
              >
                <SettingsMenu
                  label={row.selectedMode.shortLabel ?? row.selectedMode.label}
                  className="w-48"
                  menuClassName="w-64"
                  groups={[{
                    id: `${row.kind}-permissions`,
                    options: row.modeOptions.map((option) => ({
                      id: option.value,
                      label: option.shortLabel ?? option.label,
                      detail: option.description,
                      selected: option.value === row.selectedMode?.value,
                      onSelect: () => {
                        preferences.set(
                          "defaultSessionModeByAgentKind",
                          withUpdatedDefaultSessionModeByAgentKind(
                            preferences.defaultSessionModeByAgentKind,
                            row.kind,
                            option.value,
                          ),
                        );
                      },
                    })),
                  }]}
                />
              </SettingsCardRow>
            ) : null}

            {row.liveDefaultControls.map((control) => (
              <SettingsCardRow
                key={control.key}
                label={control.label}
                description={control.staleStoredValue
                  ? "Stored value is no longer available for this model"
                  : "Applied to new sessions when the live control is available"}
              >
                <SettingsMenu
                  label={control.selectedValue.label}
                  className="w-44"
                  menuClassName="w-56"
                  groups={[{
                    id: `${row.kind}-${control.key}`,
                    options: control.values.map((option) => ({
                      id: option.value,
                      label: option.label,
                      detail: option.description ?? undefined,
                      selected: option.value === control.selectedValue.value,
                      onSelect: () => {
                        preferences.set(
                          "defaultLiveSessionControlValuesByAgentKind",
                          withUpdatedDefaultLiveSessionControlValueByAgentKind(
                            preferences.defaultLiveSessionControlValuesByAgentKind,
                            row.kind,
                            control.key,
                            option.value,
                          ),
                        );
                      },
                    })),
                  }]}
                />
              </SettingsCardRow>
            ))}

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
          </SettingsCard>
        </AgentDefaultsSection>
      ))}
    </section>
  );
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
