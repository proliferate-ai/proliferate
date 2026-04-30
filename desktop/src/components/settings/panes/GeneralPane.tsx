import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useModelRegistriesQuery } from "@anyharness/sdk-react";
import type { ModelRegistry } from "@anyharness/sdk";
import { useShallow } from "zustand/react/shallow";
import { LoadingState } from "@/components/feedback/LoadingIllustration";
import { SettingsCard } from "@/components/settings/SettingsCard";
import { SettingsCardRow } from "@/components/settings/SettingsCardRow";
import { Button } from "@/components/ui/Button";
import { SettingsMenu } from "@/components/ui/SettingsMenu";
import { SettingsPageHeader } from "@/components/settings/SettingsPageHeader";
import { ProviderIcon } from "@/components/ui/icons";
import { Switch } from "@/components/ui/Switch";
import { OpenTargetIcon } from "@/components/workspace/open-target/OpenTargetIcon";
import { useAgentCatalog } from "@/hooks/agents/use-agent-catalog";
import { useAvailableEditors } from "@/hooks/settings/use-available-editors";
import { resolveEffectiveChatDefaults } from "@/lib/domain/chat/preference-resolvers";
import {
  listConfiguredSessionControlValues,
  resolveEffectiveConfiguredSessionControlValue,
  withUpdatedDefaultSessionModeByAgentKind,
} from "@/lib/domain/chat/session-mode-control";
import { emitTurnEnd } from "@/lib/integrations/anyharness/turn-end-events";
import type { EditorInfo, OpenTargetIconId } from "@/platform/tauri/shell";
import {
  type TurnEndSoundId,
  useUserPreferencesStore,
} from "@/stores/preferences/user-preferences-store";
import { useHarnessStore } from "@/stores/sessions/harness-store";

const EMPTY_MODEL_REGISTRIES: ModelRegistry[] = [];
const EMPTY_EDITORS: EditorInfo[] = [];
const FINDER_TARGET = { id: "finder", label: "Finder", iconId: "finder" as const };
const TERMINAL_TARGET = { id: "terminal", label: "Terminal", iconId: "terminal" as const };
const BRANCH_PREFIX_OPTIONS = [
  { id: "none" as const, label: "None" },
  { id: "proliferate" as const, label: "Proliferate" },
  { id: "github_username" as const, label: "GitHub username" },
];
const SOUND_LABELS: Record<TurnEndSoundId, string> = {
  ding: "Ding",
  gong: "Gong",
};
const TURN_END_SOUND_OPTIONS: { id: TurnEndSoundId; label: string }[] = [
  { id: "ding", label: "Ding" },
  { id: "gong", label: "Gong" },
];

export function GeneralPane() {
  const navigate = useNavigate();
  const { connectionState, runtimeError } = useHarnessStore(useShallow((state) => ({
    connectionState: state.connectionState,
    runtimeError: state.error,
  })));
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
    themePreset: state.themePreset,
    turnEndSoundEnabled: state.turnEndSoundEnabled,
    turnEndSoundId: state.turnEndSoundId,
    powersInCodingSessionsEnabled: state.powersInCodingSessionsEnabled,
    subagentsEnabled: state.subagentsEnabled,
    coworkWorkspaceDelegationEnabled: state.coworkWorkspaceDelegationEnabled,
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
  const currentBranchPrefixLabel = BRANCH_PREFIX_OPTIONS.find(
    (option) => option.id === preferences.branchPrefixType,
  )?.label ?? "None";

  return (
    <section className="space-y-6">
      <SettingsPageHeader
        title="General"
        description="Machine-local defaults and runtime launch behavior."
      />

      <div className="space-y-3">
        <SectionIntro
          title="Defaults"
          description="Defaults applied to new chats, repo actions, and local workspace behavior."
        />

        <SettingsCard>
          {connectionState === "connecting" ? (
            <div className="p-3">
              <LoadingState
                message="Connecting"
                subtext="Waiting for the runtime before loading chat defaults..."
              />
            </div>
          ) : connectionState === "failed" ? (
            <div className="space-y-1 p-3">
              <p className="text-sm font-medium text-foreground">Chat defaults are unavailable</p>
              <p className="text-sm text-muted-foreground">
                {runtimeError ?? "Reconnect the runtime to edit the default model and permissions."}
              </p>
            </div>
          ) : ((agentsLoading || modelRegistriesLoading) && (agents.length === 0 || modelRegistries.length === 0)) ? (
            <div className="p-3">
              <LoadingState
                message="Loading chat defaults"
                subtext="Fetching available agents and model registries..."
              />
            </div>
          ) : (
            <>
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
            </>
          )}
        </SettingsCard>

        <SettingsCard>
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
                options: BRANCH_PREFIX_OPTIONS.map((option) => ({
                  id: option.id,
                  label: option.label,
                  selected: preferences.branchPrefixType === option.id,
                  onSelect: () => preferences.set("branchPrefixType", option.id),
                })),
              }]}
            />
          </SettingsCardRow>
        </SettingsCard>
      </div>

      <div className="space-y-3">
        <SectionIntro
          title="Feedback"
          description="Local cues for completed agent work."
        />

        <SettingsCard>
          <SettingsCardRow
            label="Turn end sound"
            description="Play a sound when an agent finishes its turn"
          >
            <div className="flex items-center gap-2">
              {preferences.turnEndSoundEnabled && (
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="px-2.5 text-xs"
                    onClick={() => emitTurnEnd()}
                  >
                    Test
                  </Button>
                  <SettingsMenu
                    label={SOUND_LABELS[preferences.turnEndSoundId]}
                    className="w-32"
                    menuClassName="w-48"
                    groups={[{
                      id: "turn-end-sounds",
                      options: TURN_END_SOUND_OPTIONS
                        // Gong is intentionally tied to the TBPN preset's notification style.
                        .filter((option) => option.id !== "gong" || preferences.themePreset === "tbpn")
                        .map((option) => ({
                          id: option.id,
                          label: option.label,
                          selected: option.id === preferences.turnEndSoundId,
                          onSelect: () => preferences.set("turnEndSoundId", option.id),
                        })),
                    }]}
                  />
                </>
              )}
              <Switch
                checked={preferences.turnEndSoundEnabled}
                onChange={(value) => preferences.set("turnEndSoundEnabled", value)}
              />
            </div>
          </SettingsCardRow>
        </SettingsCard>
      </div>

      <div className="space-y-3">
        <SectionIntro
          title="Advanced"
          description="Launch policy for advanced local runtime inputs."
        />

        <SettingsCard>
          <SettingsCardRow
            label="Use Powers in coding sessions"
            description="New coding sessions receive enabled compatible Powers at launch. Existing live sessions need a restart."
          >
            <Switch
              checked={preferences.powersInCodingSessionsEnabled}
              onChange={(value) => preferences.set("powersInCodingSessionsEnabled", value)}
            />
          </SettingsCardRow>
          <SettingsCardRow
            label="Powers setup"
            description="Connector setup, auth, and enablement stay on the Powers page."
          >
            <Button
              type="button"
              variant="outline"
              onClick={() => navigate("/powers")}
            >
              Open Powers
            </Button>
          </SettingsCardRow>
        </SettingsCard>

        <SettingsCard>
          <SettingsCardRow
            label="Allow coding agents to spin up subagents"
            description="Applies to new sessions. Existing sessions keep their saved delegation policy."
          >
            <Switch
              checked={preferences.subagentsEnabled}
              onChange={(value) => preferences.set("subagentsEnabled", value)}
            />
          </SettingsCardRow>
          <SettingsCardRow
            label="Allow cowork agents to create coding workspaces"
            description="Applies to new cowork sessions. Existing cowork sessions keep their saved workspace policy."
          >
            <Switch
              checked={preferences.coworkWorkspaceDelegationEnabled}
              onChange={(value) => preferences.set("coworkWorkspaceDelegationEnabled", value)}
            />
          </SettingsCardRow>
        </SettingsCard>
      </div>
    </section>
  );
}

function SectionIntro({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="space-y-1">
      <h2 className="text-sm font-medium text-foreground">{title}</h2>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  );
}
