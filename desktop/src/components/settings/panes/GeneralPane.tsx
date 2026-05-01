import { useMemo, type ReactNode } from "react";
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
import { APP_ROUTES } from "@/config/app-routes";
import { useAgentCatalog } from "@/hooks/agents/use-agent-catalog";
import { useAvailableEditors } from "@/hooks/settings/use-available-editors";
import { withUpdatedDefaultModelIdByAgentKind } from "@/lib/domain/agents/model-options";
import { withUpdatedDefaultSessionModeByAgentKind } from "@/lib/domain/chat/session-mode-control";
import {
  buildPrimaryHarnessPreferenceUpdate,
  buildSettingsChatDefaultRows,
} from "@/lib/domain/settings/chat-defaults";
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
const CHAT_DEFAULT_SECTION_ORDER: readonly string[] = ["claude", "codex", "gemini", "cursor", "opencode"];

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
    defaultChatModelIdByAgentKind: state.defaultChatModelIdByAgentKind,
    defaultSessionModeByAgentKind: state.defaultSessionModeByAgentKind,
    defaultOpenInTargetId: state.defaultOpenInTargetId,
    branchPrefixType: state.branchPrefixType,
    themePreset: state.themePreset,
    turnEndSoundEnabled: state.turnEndSoundEnabled,
    turnEndSoundId: state.turnEndSoundId,
    pluginsInCodingSessionsEnabled: state.pluginsInCodingSessionsEnabled,
    subagentsEnabled: state.subagentsEnabled,
    coworkWorkspaceDelegationEnabled: state.coworkWorkspaceDelegationEnabled,
    set: state.set,
    setMultiple: state.setMultiple,
  })));

  const chatDefaultRows = useMemo(
    () => buildSettingsChatDefaultRows({
      modelRegistries,
      readyAgentKinds,
      preferences,
    }),
    [modelRegistries, preferences, readyAgentKinds],
  );
  const orderedChatDefaultRows = useMemo(() => {
    const rank = new Map(CHAT_DEFAULT_SECTION_ORDER.map((kind, index) => [kind, index]));
    return [...chatDefaultRows].sort((a, b) => {
      const leftRank = rank.get(a.kind) ?? Number.MAX_SAFE_INTEGER;
      const rightRank = rank.get(b.kind) ?? Number.MAX_SAFE_INTEGER;
      return leftRank === rightRank
        ? a.displayName.localeCompare(b.displayName)
        : leftRank - rightRank;
    });
  }, [chatDefaultRows]);
  const primaryHarnessLabel =
    chatDefaultRows.find((row) => row.isPrimary)?.displayName ?? "Choose harness";

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
    <section className="space-y-5">
      <SettingsPageHeader title="General" />

      <GeneralSection title="Preferences">
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
      </GeneralSection>

      <GeneralSection title="Feedback">
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
      </GeneralSection>

      <GeneralSection title="Default harness">
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
          ) : chatDefaultRows.length === 0 ? (
            <div className="space-y-1 p-3">
              <p className="text-sm font-medium text-foreground">No chat defaults are available</p>
              <p className="text-sm text-muted-foreground">
                Install and configure a chat harness before editing defaults.
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
                  options: chatDefaultRows.map((row) => ({
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
      </GeneralSection>

      {connectionState !== "failed" && orderedChatDefaultRows.map((row) => (
        <GeneralSection key={row.kind} title={`${row.displayName} defaults`}>
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
          </SettingsCard>
        </GeneralSection>
      ))}

      <GeneralSection title="Advanced">
        <SettingsCard>
          <SettingsCardRow
            label="Use plugins in coding sessions"
            description="New coding sessions receive enabled compatible plugins at launch. Existing live sessions need a restart."
          >
            <Switch
              checked={preferences.pluginsInCodingSessionsEnabled}
              onChange={(value) => preferences.set("pluginsInCodingSessionsEnabled", value)}
            />
          </SettingsCardRow>
          <SettingsCardRow
            label="Plugins setup"
            description="Connector setup, auth, and enablement stay on the Plugins page."
          >
            <Button
              type="button"
              variant="outline"
              onClick={() => navigate(APP_ROUTES.plugins)}
            >
              Open Plugins
            </Button>
          </SettingsCardRow>
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
      </GeneralSection>
    </section>
  );
}

function GeneralSection({
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
