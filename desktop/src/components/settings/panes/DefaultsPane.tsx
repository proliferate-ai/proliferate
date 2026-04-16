import { useMemo } from "react";
import { useModelRegistriesQuery } from "@anyharness/sdk-react";
import type { ModelRegistry } from "@anyharness/sdk";
import { useShallow } from "zustand/react/shallow";
import { LoadingState } from "@/components/feedback/LoadingIllustration";
import { SettingsCard } from "@/components/settings/SettingsCard";
import { SettingsCardRow } from "@/components/settings/SettingsCardRow";
import { SettingsMenu } from "@/components/settings/SettingsMenu";
import { SettingsPageHeader } from "@/components/settings/SettingsPageHeader";
import { ProviderIcon } from "@/components/ui/icons";
import { OpenTargetIcon } from "@/components/workspace/open-target/OpenTargetIcon";
import { useAgentCatalog } from "@/hooks/agents/use-agent-catalog";
import { useAvailableEditors } from "@/hooks/settings/use-available-editors";
import { resolveEffectiveChatDefaults } from "@/lib/domain/chat/preference-resolvers";
import {
  listConfiguredSessionControlValues,
  resolveEffectiveConfiguredSessionControlValue,
  withUpdatedDefaultSessionModeByAgentKind,
} from "@/lib/domain/chat/session-mode-control";
import type { EditorInfo, OpenTargetIconId } from "@/platform/tauri/shell";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";
import { useHarnessStore } from "@/stores/sessions/harness-store";

const EMPTY_MODEL_REGISTRIES: ModelRegistry[] = [];
const EMPTY_EDITORS: EditorInfo[] = [];
const FINDER_TARGET = { id: "finder", label: "Finder", iconId: "finder" as const };
const TERMINAL_TARGET = { id: "terminal", label: "Terminal", iconId: "terminal" as const };

export function DefaultsPane() {
  const connectionState = useHarnessStore((state) => state.connectionState);
  const {
    data: modelRegistries = EMPTY_MODEL_REGISTRIES,
    isLoading: modelRegistriesLoading,
  } = useModelRegistriesQuery();
  const { agents, isLoading: agentsLoading, readyAgentKinds } = useAgentCatalog();
  const { data: editors = EMPTY_EDITORS } = useAvailableEditors();
  const preferences = useUserPreferencesStore(useShallow((state) => ({
    defaultChatAgentKind: state.defaultChatAgentKind,
    defaultChatModelId: state.defaultChatModelId,
    defaultSessionModeByAgentKind: state.defaultSessionModeByAgentKind,
    defaultOpenInTargetId: state.defaultOpenInTargetId,
    branchPrefixType: state.branchPrefixType,
    set: state.set,
    setMultiple: state.setMultiple,
  })));

  const defaults = useMemo(
    () => resolveEffectiveChatDefaults(modelRegistries, agents, preferences, null),
    [agents, modelRegistries, preferences],
  );

  const readyRegistries = useMemo(
    () => modelRegistries.filter((registry) => readyAgentKinds.has(registry.kind)),
    [modelRegistries, readyAgentKinds],
  );

  const defaultPermissionOptions = useMemo(
    () => listConfiguredSessionControlValues(defaults.agentKind, "mode"),
    [defaults.agentKind],
  );

  const selectedDefaultPermission = useMemo(
    () => resolveEffectiveConfiguredSessionControlValue(
      defaults.agentKind,
      "mode",
      preferences.defaultSessionModeByAgentKind[defaults.agentKind] ?? null,
    ),
    [defaults.agentKind, preferences.defaultSessionModeByAgentKind],
  );

  const targets = useMemo(() => {
    const items: { id: string; label: string; iconId?: OpenTargetIconId }[] = editors.map((editor) => ({
      id: editor.id,
      label: editor.label,
      iconId: editor.iconId,
    }));
    items.push(FINDER_TARGET);
    items.push(TERMINAL_TARGET);
    return items;
  }, [editors]);

  const currentTarget = targets.find((target) => target.id === preferences.defaultOpenInTargetId) ?? null;
  const currentTargetLabel = currentTarget?.label ?? preferences.defaultOpenInTargetId;
  const branchPrefixOptions = [
    { id: "none" as const, label: "None" },
    { id: "proliferate" as const, label: "Proliferate" },
    { id: "github_username" as const, label: "GitHub username" },
  ];
  const currentBranchPrefixLabel = branchPrefixOptions.find(
    (option) => option.id === preferences.branchPrefixType,
  )?.label ?? "None";

  if (connectionState !== "healthy") {
    return (
      <section className="space-y-6">
        <SettingsPageHeader
          title="Defaults"
          description="Machine-local defaults for new coding sessions."
        />
        <LoadingState message="Connecting" subtext="Waiting for the runtime..." />
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <SettingsPageHeader
        title="Defaults"
        description="Machine-local defaults for new coding sessions."
      />

      <SettingsCard>
        {((agentsLoading || modelRegistriesLoading) && (agents.length === 0 || modelRegistries.length === 0)) ? (
          <div className="p-3">
            <LoadingState
              message="Loading chat defaults"
              subtext="Fetching available agents and model registries..."
            />
          </div>
        ) : (
          <SettingsCardRow
            label="Default model"
            description="Model for new chats"
          >
            <SettingsMenu
              label={defaults.modelDisplayName}
              className="w-60"
              menuClassName="w-72"
              groups={readyRegistries.map((registry) => ({
                id: registry.kind,
                label: registry.displayName,
                options: registry.models.map((model) => ({
                  id: `${registry.kind}:${model.id}`,
                  label: model.displayName,
                  icon: <ProviderIcon kind={registry.kind} className="size-3.5" />,
                  selected: defaults.agentKind === registry.kind && defaults.modelId === model.id,
                  onSelect: () => {
                    const nextDefaultModes = withUpdatedDefaultSessionModeByAgentKind(
                      preferences.defaultSessionModeByAgentKind,
                      registry.kind,
                      resolveEffectiveConfiguredSessionControlValue(
                        registry.kind,
                        "mode",
                        preferences.defaultSessionModeByAgentKind[registry.kind] ?? null,
                      )?.value,
                    );
                    preferences.setMultiple({
                      defaultChatAgentKind: registry.kind,
                      defaultChatModelId: model.id,
                      defaultSessionModeByAgentKind: nextDefaultModes,
                    });
                  },
                })),
              }))}
            />
          </SettingsCardRow>
        )}

        {defaultPermissionOptions.length > 0 && selectedDefaultPermission && (
          <SettingsCardRow
            label="Default permissions"
            description="Permission mode for new chats on this harness"
          >
            <SettingsMenu
              label={selectedDefaultPermission.shortLabel ?? selectedDefaultPermission.label}
              className="w-48"
              menuClassName="w-64"
              groups={[{
                id: "permissions",
                options: defaultPermissionOptions.map((option) => ({
                  id: option.value,
                  label: option.shortLabel ?? option.label,
                  detail: option.description,
                  selected: option.value === selectedDefaultPermission.value,
                  onSelect: () => {
                    preferences.set(
                      "defaultSessionModeByAgentKind",
                      withUpdatedDefaultSessionModeByAgentKind(
                        preferences.defaultSessionModeByAgentKind,
                        defaults.agentKind,
                        option.value,
                      ),
                    );
                  },
                })),
              }]}
            />
          </SettingsCardRow>
        )}

        <SettingsCardRow
          label="Default open in"
          description="Which app the Open in button uses"
        >
          <SettingsMenu
            label={currentTargetLabel}
            leading={<OpenTargetIcon iconId={currentTarget?.iconId} className="size-4 rounded-sm" />}
            className="w-44"
            menuClassName="w-52"
            groups={[{
              id: "targets",
              options: targets.map((target) => ({
                id: target.id,
                label: target.label,
                icon: <OpenTargetIcon iconId={target.iconId} className="size-4 rounded-sm" />,
                selected: preferences.defaultOpenInTargetId === target.id,
                onSelect: () => preferences.set("defaultOpenInTargetId", target.id),
              })),
            }]}
          />
        </SettingsCardRow>
      </SettingsCard>

      <SettingsCard>
        <SettingsCardRow
          label="Git branch prefix"
          description="Prefix for auto-generated branch names"
        >
          <SettingsMenu
            label={currentBranchPrefixLabel}
            className="w-44"
            menuClassName="w-48"
            groups={[{
              id: "branch-prefix",
              options: branchPrefixOptions.map((option) => ({
                id: option.id,
                label: option.label,
                selected: preferences.branchPrefixType === option.id,
                onSelect: () => preferences.set("branchPrefixType", option.id),
              })),
            }]}
          />
        </SettingsCardRow>
      </SettingsCard>
    </section>
  );
}
