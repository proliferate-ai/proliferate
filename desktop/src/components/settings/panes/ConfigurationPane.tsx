import { useMemo, useState } from "react";
import {
  useModelRegistriesQuery,
} from "@anyharness/sdk-react";
import type { ModelRegistry } from "@anyharness/sdk";
import { useShallow } from "zustand/react/shallow";
import { useAgentCatalog } from "@/hooks/agents/use-agent-catalog";
import { useAvailableEditors } from "@/hooks/settings/use-available-editors";
import { useThemePreset, useColorMode } from "@/hooks/theme/use-theme";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";
import { resolveEffectiveChatDefaults } from "@/lib/domain/chat/preference-resolvers";
import {
  listConfiguredSessionControlValues,
  resolveEffectiveConfiguredSessionControlValue,
  withUpdatedDefaultSessionModeByAgentKind,
} from "@/lib/domain/chat/session-mode-control";
import {
  COLOR_MODES,
  isModeLockedPreset,
  THEME_PRESETS,
  type ColorMode,
  type ThemePreset,
} from "@/config/theme";
import { LoadingState } from "@/components/feedback/LoadingIllustration";
import { Check, ChevronUpDown, Monitor, Moon, ProviderIcon, Sun } from "@/components/ui/icons";
import { SettingsPageHeader } from "@/components/settings/SettingsPageHeader";
import { SettingsCard } from "@/components/settings/SettingsCard";
import { SettingsCardRow } from "@/components/settings/SettingsCardRow";
import { Switch } from "@/components/ui/Switch";
import { OpenTargetIcon } from "@/components/workspace/open-target/OpenTargetIcon";
import type { TurnEndSoundId } from "@/stores/preferences/user-preferences-store";
import { emitTurnEnd } from "@/lib/integrations/anyharness/turn-end-events";
import type { EditorInfo, OpenTargetIconId } from "@/platform/tauri/shell";

const EMPTY_MODEL_REGISTRIES: ModelRegistry[] = [];
const EMPTY_EDITORS: EditorInfo[] = [];
const FINDER_TARGET = { id: "finder", label: "Finder", iconId: "finder" as const };
const TERMINAL_TARGET = { id: "terminal", label: "Terminal", iconId: "terminal" as const };

const PRESET_LABELS: Record<ThemePreset, string> = {
  ship: "Dominic",
  mono: "Mono",
  tbpn: "TBPN",
  original: "Original",
};

const MODE_LABELS: Record<ColorMode, string> = {
  dark: "Dark",
  light: "Light",
  system: "System",
};

const SOUND_LABELS: Record<TurnEndSoundId, string> = {
  ding: "Ding",
  gong: "Gong",
};

const TURN_END_SOUND_OPTIONS: { id: TurnEndSoundId; label: string }[] = [
  { id: "ding", label: "Ding" },
  { id: "gong", label: "Gong" },
];

const MODE_ICONS: Record<ColorMode, React.FC<{ className?: string }>> = {
  dark: Moon,
  light: Sun,
  system: Monitor,
};

export function ConfigurationPane() {
  const connectionState = useHarnessStore((state) => state.connectionState);
  const {
    data: modelRegistries = EMPTY_MODEL_REGISTRIES,
    isLoading: modelRegistriesLoading,
  } = useModelRegistriesQuery();
  const { agents, isLoading: agentsLoading, readyAgentKinds } = useAgentCatalog();
  const { data: editors = EMPTY_EDITORS } = useAvailableEditors();
  const [preset, setPreset] = useThemePreset();
  const [mode, setMode] = useColorMode();
  const preferences = useUserPreferencesStore(useShallow((state) => ({
    defaultChatAgentKind: state.defaultChatAgentKind,
    defaultChatModelId: state.defaultChatModelId,
    defaultSessionModeByAgentKind: state.defaultSessionModeByAgentKind,
    defaultOpenInTargetId: state.defaultOpenInTargetId,
    branchPrefixType: state.branchPrefixType,
    turnEndSoundEnabled: state.turnEndSoundEnabled,
    turnEndSoundId: state.turnEndSoundId,
    set: state.set,
    setMultiple: state.setMultiple,
  })));

  const [themeMenuOpen, setThemeMenuOpen] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [permissionsMenuOpen, setPermissionsMenuOpen] = useState(false);
  const [targetMenuOpen, setTargetMenuOpen] = useState(false);
  const [branchPrefixMenuOpen, setBranchPrefixMenuOpen] = useState(false);
  const [soundMenuOpen, setSoundMenuOpen] = useState(false);

  const defaults = useMemo(
    () => resolveEffectiveChatDefaults(modelRegistries, agents, preferences, null),
    [agents, modelRegistries, preferences],
  );

  const readyRegistries = useMemo(
    () => modelRegistries.filter((config) => readyAgentKinds.has(config.kind)),
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
  const modeLocked = isModeLockedPreset(preset);
  const displayedMode: ColorMode = modeLocked ? "dark" : mode;

  if (connectionState !== "healthy") {
    return (
      <section className="space-y-6">
        <SettingsPageHeader
          title="Configuration"
          description="Machine-local defaults for appearance, launch model, and repository behavior."
        />
        <LoadingState message="Connecting" subtext="Waiting for the runtime..." />
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <SettingsPageHeader
        title="Configuration"
        description="Machine-local defaults for appearance, launch model, and repository behavior."
      />

      <SettingsCard>
        <SettingsCardRow
          label="Theme"
          description="Choose the Proliferate visual preset"
        >
        <div className="relative">
          <button
            type="button"
            onClick={() => setThemeMenuOpen((open) => !open)}
            className="flex h-8 min-w-[144px] items-center gap-2 rounded-md border border-input bg-background pl-3 pr-2.5 py-2 text-foreground transition-colors hover:bg-accent"
          >
            <span className="truncate flex-1 text-left text-sm">{PRESET_LABELS[preset]}</span>
            <ChevronUpDown className="h-3 w-3 shrink-0 text-muted-foreground" />
          </button>
          {themeMenuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setThemeMenuOpen(false)} />
              <div className="absolute top-full right-0 mt-1 z-50 w-48 rounded-lg border border-border bg-popover text-popover-foreground shadow-md overflow-hidden">
                <div className="p-1">
                  {THEME_PRESETS.map((themePreset) => {
                    const selected = themePreset === preset;
                    return (
                      <button
                        key={themePreset}
                        type="button"
                        onClick={() => {
                          setPreset(themePreset);
                          setThemeMenuOpen(false);
                        }}
                        className={`w-full flex items-center justify-between px-2.5 py-2 text-sm rounded-md text-left hover:bg-muted/50 transition-colors ${
                          selected ? "text-foreground" : "text-muted-foreground"
                        }`}
                      >
                        <span>{PRESET_LABELS[themePreset]}</span>
                        {selected && <Check className="size-3.5 text-foreground" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>
        </SettingsCardRow>

        <SettingsCardRow
          label="Mode"
        description={
          modeLocked
            ? "This theme always uses the same appearance"
            : "Light, dark, or follow the system setting"
        }
      >
        <div className="flex gap-1.5">
          {COLOR_MODES.map((candidateMode) => {
            const Icon = MODE_ICONS[candidateMode];
            return (
              <button
                key={candidateMode}
                type="button"
                onClick={() => {
                  if (modeLocked) {
                    return;
                  }
                  setMode(candidateMode);
                }}
                disabled={modeLocked}
                className={`flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors ${
                  displayedMode === candidateMode
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-muted/50"
                } ${modeLocked ? "cursor-default opacity-60" : ""}`}
              >
                <Icon className="h-3.5 w-3.5" />
                {MODE_LABELS[candidateMode]}
              </button>
            );
          })}
        </div>
        </SettingsCardRow>
      </SettingsCard>

      <SettingsCard>
        <SettingsCardRow
          label="Turn end sound"
          description="Play a sound when an agent finishes its turn"
        >
          <div className="flex items-center gap-2">
            {preferences.turnEndSoundEnabled && (
              <>
                <button
                  type="button"
                  onClick={() => emitTurnEnd()}
                  className="flex h-8 items-center rounded-md px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/50"
                >
                  Test
                </button>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setSoundMenuOpen((open) => !open)}
                    className="flex h-8 min-w-[110px] items-center gap-2 rounded-md border border-input bg-background pl-3 pr-2.5 py-2 text-foreground transition-colors hover:bg-accent"
                  >
                    <span className="truncate flex-1 text-left text-sm">
                      {SOUND_LABELS[preferences.turnEndSoundId]}
                    </span>
                    <ChevronUpDown className="h-3 w-3 shrink-0 text-muted-foreground" />
                  </button>
                  {soundMenuOpen && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setSoundMenuOpen(false)} />
                      <div className="absolute top-full right-0 mt-1 z-50 w-48 rounded-lg border border-border bg-popover text-popover-foreground shadow-md overflow-hidden">
                        <div className="p-1">
                          {TURN_END_SOUND_OPTIONS
                            .filter((opt) => opt.id !== "gong" || preset === "tbpn")
                            .map((opt) => {
                              const selected = opt.id === preferences.turnEndSoundId;
                              return (
                                <button
                                  key={opt.id}
                                  type="button"
                                  onClick={() => {
                                    preferences.set("turnEndSoundId", opt.id);
                                    setSoundMenuOpen(false);
                                  }}
                                  className={`w-full flex items-center justify-between px-2.5 py-2 text-sm rounded-md text-left hover:bg-muted/50 transition-colors ${
                                    selected ? "text-foreground" : "text-muted-foreground"
                                  }`}
                                >
                                  <span>{opt.label}</span>
                                  {selected && <Check className="size-3.5 text-foreground" />}
                                </button>
                              );
                            })}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </>
            )}
            <Switch
              checked={preferences.turnEndSoundEnabled}
              onChange={(v) => preferences.set("turnEndSoundEnabled", v)}
            />
          </div>
        </SettingsCardRow>
      </SettingsCard>

      <SettingsCard>
        {((agentsLoading || modelRegistriesLoading) && (agents.length === 0 || modelRegistries.length === 0)) ? (
          <div className="p-3">
            <LoadingState message="Loading chat defaults" subtext="Fetching available agents and model registries..." />
          </div>
        ) : (
          <SettingsCardRow
            label="Default model"
            description="Model for new chats"
          >
          <div className="relative">
            <button
              type="button"
              onClick={() => setModelMenuOpen((open) => !open)}
              className="flex h-8 hover:bg-accent items-center gap-1 rounded-md border border-input bg-background text-foreground pl-3 pr-2.5 py-2 w-[240px]"
            >
              <span className="truncate flex-1 text-left text-sm">{defaults.modelDisplayName}</span>
              <ChevronUpDown className="w-3 h-3 shrink-0 text-muted-foreground" />
            </button>
            {modelMenuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setModelMenuOpen(false)} />
                <div className="absolute top-full right-0 mt-1 z-50 w-72 rounded-lg border border-border bg-popover text-popover-foreground shadow-md overflow-hidden">
                  <div className="overflow-y-auto max-h-80 p-1">
                    {readyRegistries.map((config, idx) => (
                      <div key={config.kind}>
                        {idx > 0 && <div className="border-t border-border/40 my-1" />}
                        <div className="px-2 pt-1.5 pb-1 text-sm text-muted-foreground">
                          {config.displayName}
                        </div>
                        {config.models.map((model) => {
                          const selected = defaults.agentKind === config.kind && defaults.modelId === model.id;
                          return (
                            <button
                              key={model.id}
                              type="button"
                              onClick={() => {
                                const nextDefaultModes = withUpdatedDefaultSessionModeByAgentKind(
                                  preferences.defaultSessionModeByAgentKind,
                                  config.kind,
                                  resolveEffectiveConfiguredSessionControlValue(
                                    config.kind,
                                    "mode",
                                    preferences.defaultSessionModeByAgentKind[config.kind] ?? null,
                                  )?.value,
                                );
                                preferences.setMultiple({
                                  defaultChatAgentKind: config.kind,
                                  defaultChatModelId: model.id,
                                  defaultSessionModeByAgentKind: nextDefaultModes,
                                });
                                setModelMenuOpen(false);
                              }}
                              className={`w-full flex items-center justify-between px-2.5 py-1.5 text-sm rounded-md text-left hover:bg-muted/50 transition-colors ${
                                selected ? "text-foreground" : "text-muted-foreground"
                              }`}
                            >
                              <div className="flex items-center gap-2">
                                <ProviderIcon kind={config.kind} className="size-3.5" />
                                <span>{model.displayName}</span>
                              </div>
                              {selected && <Check className="size-3.5 text-foreground" />}
                            </button>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
          </SettingsCardRow>
        )}

        {defaultPermissionOptions.length > 0 && selectedDefaultPermission && (
          <SettingsCardRow
            label="Default permissions"
            description="Permission mode for new chats on this harness"
          >
            <div className="relative">
              <button
                type="button"
                onClick={() => setPermissionsMenuOpen((open) => !open)}
                className="flex h-8 min-w-[180px] items-center gap-1 rounded-md border border-input bg-background text-foreground pl-3 pr-2.5 py-2 hover:bg-accent"
              >
                <span className="truncate flex-1 text-left text-sm">
                  {selectedDefaultPermission.shortLabel ?? selectedDefaultPermission.label}
                </span>
                <ChevronUpDown className="w-3 h-3 shrink-0 text-muted-foreground" />
              </button>
              {permissionsMenuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setPermissionsMenuOpen(false)} />
                  <div className="absolute top-full right-0 mt-1 z-50 w-64 rounded-lg border border-border bg-popover text-popover-foreground shadow-md overflow-hidden">
                    <div className="p-1">
                      {defaultPermissionOptions.map((option) => {
                        const selected = option.value === selectedDefaultPermission.value;
                        return (
                          <button
                            key={option.value}
                            type="button"
                            onClick={() => {
                              preferences.set(
                                "defaultSessionModeByAgentKind",
                                withUpdatedDefaultSessionModeByAgentKind(
                                  preferences.defaultSessionModeByAgentKind,
                                  defaults.agentKind,
                                  option.value,
                                ),
                              );
                              setPermissionsMenuOpen(false);
                            }}
                            className={`w-full flex items-center justify-between px-2.5 py-1.5 text-sm rounded-md text-left hover:bg-muted/50 transition-colors ${
                              selected ? "text-foreground" : "text-muted-foreground"
                            }`}
                          >
                            <div className="flex min-w-0 flex-1 flex-col">
                              <span className="truncate">
                                {option.shortLabel ?? option.label}
                              </span>
                              {option.description && (
                                <span className="truncate text-xs text-muted-foreground">
                                  {option.description}
                                </span>
                              )}
                            </div>
                            {selected && <Check className="size-3.5 text-foreground" />}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}
            </div>
          </SettingsCardRow>
        )}

        <SettingsCardRow
          label="Default open in"
          description="Which app the Open in button uses"
        >
        <div className="relative">
          <button
            type="button"
            onClick={() => setTargetMenuOpen((open) => !open)}
            className="flex h-8 hover:bg-accent items-center gap-2 rounded-md border border-input bg-background text-foreground pl-2.5 pr-2.5 py-2 w-[160px]"
          >
            <OpenTargetIcon iconId={currentTarget?.iconId} className="size-4 rounded-sm shrink-0" />
            <span className="truncate flex-1 text-left text-sm">{currentTargetLabel}</span>
            <ChevronUpDown className="w-3 h-3 shrink-0 text-muted-foreground" />
          </button>
          {targetMenuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setTargetMenuOpen(false)} />
              <div className="absolute top-full right-0 mt-1 z-50 w-52 rounded-lg border border-border bg-popover text-popover-foreground shadow-md overflow-hidden">
                <div className="p-1">
                  {targets.map((target) => {
                    const selected = preferences.defaultOpenInTargetId === target.id;
                    return (
                      <button
                        key={target.id}
                        type="button"
                        onClick={() => {
                          preferences.set("defaultOpenInTargetId", target.id);
                          setTargetMenuOpen(false);
                        }}
                        className={`w-full flex items-center justify-between px-2.5 py-1.5 text-sm rounded-md text-left hover:bg-muted/50 transition-colors ${
                          selected ? "text-foreground" : "text-muted-foreground"
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <OpenTargetIcon iconId={target.iconId} className="size-4 rounded-sm" />
                          <span>{target.label}</span>
                        </div>
                        {selected && <Check className="size-3.5 text-foreground" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>
        </SettingsCardRow>
      </SettingsCard>

      <SettingsCard>
        <SettingsCardRow
          label="Git branch prefix"
          description="Prefix for auto-generated branch names"
        >
        <div className="relative">
          <button
            type="button"
            onClick={() => setBranchPrefixMenuOpen((open) => !open)}
            className="flex h-8 hover:bg-accent items-center gap-1 rounded-md border border-input bg-background text-foreground pl-3 pr-2.5 py-2 w-[160px]"
          >
            <span className="truncate flex-1 text-left text-sm">{currentBranchPrefixLabel}</span>
            <ChevronUpDown className="w-3 h-3 shrink-0 text-muted-foreground" />
          </button>
          {branchPrefixMenuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setBranchPrefixMenuOpen(false)} />
              <div className="absolute top-full right-0 mt-1 z-50 w-48 rounded-lg border border-border bg-popover text-popover-foreground shadow-md overflow-hidden">
                <div className="p-1">
                  {branchPrefixOptions.map((option) => {
                    const selected = preferences.branchPrefixType === option.id;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => {
                          preferences.set("branchPrefixType", option.id);
                          setBranchPrefixMenuOpen(false);
                        }}
                        className={`w-full flex items-center justify-between px-2.5 py-1.5 text-sm rounded-md text-left hover:bg-muted/50 transition-colors ${
                          selected ? "text-foreground" : "text-muted-foreground"
                        }`}
                      >
                        <span>{option.label}</span>
                        {selected && <Check className="size-3.5 text-foreground" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>
        </SettingsCardRow>
      </SettingsCard>
    </section>
  );
}
