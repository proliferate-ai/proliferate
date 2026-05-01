import type { FC, ReactNode } from "react";
import { SettingsCard } from "@/components/settings/SettingsCard";
import { SettingsCardRow } from "@/components/settings/SettingsCardRow";
import { SettingsMenu } from "@/components/ui/SettingsMenu";
import { SettingsPageHeader } from "@/components/settings/SettingsPageHeader";
import { Button } from "@/components/ui/Button";
import { DiffViewer } from "@/components/ui/content/DiffViewer";
import { FileDiffCard } from "@/components/ui/content/FileDiffCard";
import { Monitor, Moon, Sun } from "@/components/ui/icons";
import { Switch } from "@/components/ui/Switch";
import {
  READABLE_CODE_FONT_SIZE_LABELS,
  READABLE_CODE_FONT_SIZE_OPTIONS,
  UI_FONT_SIZE_LABELS,
  UI_FONT_SIZE_OPTIONS,
} from "@/config/appearance";
import {
  COLOR_MODES,
  isModeLockedPreset,
  THEME_PRESETS,
  type ColorMode,
  type ThemePreset,
} from "@/config/theme";
import { useColorMode, useThemePreset } from "@/hooks/theme/use-theme";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";

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

const PREVIEW_DIFF = `@@ -1,5 +1,5 @@
 export const environment = {
-  branch: "develop",
+  branch: "main",
   command: "pnpm dev",
 };`;

export function AppearancePane() {
  const [preset, setPreset] = useThemePreset();
  const [mode, setMode] = useColorMode();
  const transparentChromeEnabled = useUserPreferencesStore((state) => state.transparentChromeEnabled);
  const uiFontSizeId = useUserPreferencesStore((state) => state.uiFontSizeId);
  const readableCodeFontSizeId = useUserPreferencesStore((state) => state.readableCodeFontSizeId);
  const setPreference = useUserPreferencesStore((state) => state.set);
  const modeLocked = isModeLockedPreset(preset);
  const displayedMode: ColorMode = modeLocked ? "dark" : mode;

  return (
    <section className="space-y-5">
      <SettingsPageHeader title="Appearance" />

      <AppearanceSection title="Preferences">
        <SettingsCard>
          <AppearancePreview />

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
            label="UI font size"
            description="Scale app and chat text"
          >
            <SettingsMenu
              label={UI_FONT_SIZE_LABELS[uiFontSizeId]}
              className="w-40"
              menuClassName="w-52"
              groups={[{
                id: "ui-font-size",
                options: UI_FONT_SIZE_OPTIONS.map((option) => ({
                  id: option.id,
                  label: option.label,
                  detail: option.detail,
                  selected: option.id === uiFontSizeId,
                  onSelect: () => setPreference("uiFontSizeId", option.id),
                })),
              }]}
            />
          </SettingsCardRow>

          <SettingsCardRow
            label="Code font size"
            description="Scale editors, diffs, and code blocks"
          >
            <SettingsMenu
              label={READABLE_CODE_FONT_SIZE_LABELS[readableCodeFontSizeId]}
              className="w-40"
              menuClassName="w-56"
              groups={[{
                id: "readable-code-font-size",
                options: READABLE_CODE_FONT_SIZE_OPTIONS.map((option) => ({
                  id: option.id,
                  label: option.label,
                  detail: option.detail,
                  selected: option.id === readableCodeFontSizeId,
                  onSelect: () => setPreference("readableCodeFontSizeId", option.id),
                })),
              }]}
            />
          </SettingsCardRow>
        </SettingsCard>
      </AppearanceSection>

      <AppearanceSection title="Advanced">
        <SettingsCard>
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
      </AppearanceSection>
    </section>
  );
}

function AppearanceSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <h2 className="text-sm font-medium text-foreground">{title}</h2>
      {children}
    </div>
  );
}

function AppearancePreview() {
  return (
    <div className="space-y-2 p-2.5">
      <div className="flex items-center justify-between gap-3 px-0.5">
        <div className="min-w-0 text-xs font-medium text-muted-foreground">
          Preview
        </div>
        <div className="shrink-0 text-xs text-muted-foreground">
          Git diff
        </div>
      </div>
      <div className="overflow-hidden rounded-lg border border-border/70">
        <FileDiffCard
          filePath="src/environment.ts"
          additions={1}
          deletions={1}
          isExpanded
          embedded
          collapsible={false}
        >
          <DiffViewer
            patch={PREVIEW_DIFF}
            filePath="src/environment.ts"
            className="w-full"
            viewportClassName="max-h-[calc(var(--diffs-line-height)*5)]"
            variant="chat"
          />
        </FileDiffCard>
      </div>
    </div>
  );
}
