import type { FC } from "react";
import { SettingsCard } from "@/components/settings/SettingsCard";
import { SettingsCardRow } from "@/components/settings/SettingsCardRow";
import { SettingsMenu } from "@/components/ui/SettingsMenu";
import { SettingsPageHeader } from "@/components/settings/SettingsPageHeader";
import { Button } from "@/components/ui/Button";
import { Monitor, Moon, Sun } from "@/components/ui/icons";
import { Switch } from "@/components/ui/Switch";
import {
  COLOR_MODES,
  isModeLockedPreset,
  THEME_PRESETS,
  type ColorMode,
  type ThemePreset,
} from "@/config/theme";
import { useColorMode, useThemePreset } from "@/hooks/theme/use-theme";
import { emitTurnEnd } from "@/lib/integrations/anyharness/turn-end-events";
import {
  type TurnEndSoundId,
  useUserPreferencesStore,
} from "@/stores/preferences/user-preferences-store";

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

const MODE_ICONS: Record<ColorMode, FC<{ className?: string }>> = {
  dark: Moon,
  light: Sun,
  system: Monitor,
};

const SOUND_LABELS: Record<TurnEndSoundId, string> = {
  ding: "Ding",
  gong: "Gong",
};

const TURN_END_SOUND_OPTIONS: { id: TurnEndSoundId; label: string }[] = [
  { id: "ding", label: "Ding" },
  { id: "gong", label: "Gong" },
];

export function AppearancePane() {
  const [preset, setPreset] = useThemePreset();
  const [mode, setMode] = useColorMode();
  const transparentChromeEnabled = useUserPreferencesStore((state) => state.transparentChromeEnabled);
  const turnEndSoundEnabled = useUserPreferencesStore((state) => state.turnEndSoundEnabled);
  const turnEndSoundId = useUserPreferencesStore((state) => state.turnEndSoundId);
  const setPreference = useUserPreferencesStore((state) => state.set);
  const modeLocked = isModeLockedPreset(preset);
  const displayedMode: ColorMode = modeLocked ? "dark" : mode;

  return (
    <section className="space-y-6">
      <SettingsPageHeader
        title="Appearance"
        description="Visual preferences and local feedback cues."
      />

      <SettingsCard>
        <SettingsCardRow
          label="Theme"
          description="Choose the Proliferate visual preset"
        >
          <SettingsMenu
            label={PRESET_LABELS[preset]}
            className="w-40"
            menuClassName="w-48"
            groups={[{
              id: "theme-presets",
              options: THEME_PRESETS.map((themePreset) => ({
                id: themePreset,
                label: PRESET_LABELS[themePreset],
                selected: themePreset === preset,
                onSelect: () => setPreset(themePreset),
              })),
            }]}
          />
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
                <Button
                  key={candidateMode}
                  type="button"
                  variant={displayedMode === candidateMode ? "secondary" : "ghost"}
                  size="sm"
                  disabled={modeLocked}
                  className="px-2.5 text-xs"
                  onClick={() => {
                    if (!modeLocked) {
                      setMode(candidateMode);
                    }
                  }}
                >
                  <Icon className="size-3.5" />
                  {MODE_LABELS[candidateMode]}
                </Button>
              );
            })}
          </div>
        </SettingsCardRow>

        <SettingsCardRow
          label="Transparent chrome"
          description="Use glass treatment for workspace headers and tab bars"
        >
          <Switch
            checked={transparentChromeEnabled}
            onChange={(value) => setPreference("transparentChromeEnabled", value)}
          />
        </SettingsCardRow>
      </SettingsCard>

      <SettingsCard>
        <SettingsCardRow
          label="Turn end sound"
          description="Play a sound when an agent finishes its turn"
        >
          <div className="flex items-center gap-2">
            {turnEndSoundEnabled && (
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
                  label={SOUND_LABELS[turnEndSoundId]}
                  className="w-32"
                  menuClassName="w-48"
                  groups={[{
                    id: "turn-end-sounds",
                    options: TURN_END_SOUND_OPTIONS
                      // Gong is intentionally tied to the TBPN preset's notification style.
                      .filter((option) => option.id !== "gong" || preset === "tbpn")
                      .map((option) => ({
                        id: option.id,
                        label: option.label,
                        selected: option.id === turnEndSoundId,
                        onSelect: () => setPreference("turnEndSoundId", option.id),
                      })),
                  }]}
                />
              </>
            )}
            <Switch
              checked={turnEndSoundEnabled}
              onChange={(value) => setPreference("turnEndSoundEnabled", value)}
            />
          </div>
        </SettingsCardRow>
      </SettingsCard>
    </section>
  );
}
