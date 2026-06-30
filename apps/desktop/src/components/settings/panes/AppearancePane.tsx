import type { FC, ReactNode } from "react";
import { SettingsCard } from "@/components/settings/shared/SettingsCard";
import { SettingsCardRow } from "@/components/settings/shared/SettingsCardRow";
import { SettingsMenu } from "@proliferate/ui/primitives/SettingsMenu";
import { SettingsPageHeader } from "@/components/settings/shared/SettingsPageHeader";
import { Button } from "@proliferate/ui/primitives/Button";
import { DiffViewer } from "@/components/content/ui/DiffViewer";
import { FileDiffCard } from "@/components/content/ui/FileDiffCard";
import { Minus, Monitor, Moon, Plus, Sun } from "@proliferate/ui/icons";
import { Switch } from "@proliferate/ui/primitives/Switch";
import {
  READABLE_CODE_FONT_SIZE_LABELS,
  READABLE_CODE_FONT_SIZE_OPTIONS,
  UI_FONT_SIZE_LABELS,
  UI_FONT_SIZE_OPTIONS,
  WINDOW_ZOOM_LABELS,
} from "@/lib/domain/preferences/appearance-presentation";
import {
  stepWindowZoomId,
  WINDOW_ZOOM_IDS,
} from "@/lib/domain/preferences/appearance";
import {
  COLOR_MODES,
  isModeLockedPreset,
  THEME_PRESETS,
  type ColorMode,
  type ThemePreset,
} from "@/config/theme";
import { useColorMode, useThemePreset } from "@/hooks/theme/workflows/use-theme-preferences";
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

const SETTINGS_CONTROL_WIDTH_CLASS = "w-[240px]";
const SETTINGS_CONTROL_MENU_CLASS = "w-[240px]";

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
  const windowZoomId = useUserPreferencesStore((state) => state.windowZoomId);
  const setPreference = useUserPreferencesStore((state) => state.set);
  const modeLocked = isModeLockedPreset(preset);
  const displayedMode: ColorMode = modeLocked ? "dark" : mode;
  const canDecreaseZoom = windowZoomId !== WINDOW_ZOOM_IDS[0];
  const canIncreaseZoom = windowZoomId !== WINDOW_ZOOM_IDS[WINDOW_ZOOM_IDS.length - 1];

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
              className={SETTINGS_CONTROL_WIDTH_CLASS}
              menuClassName={SETTINGS_CONTROL_MENU_CLASS}
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
            label="Window zoom"
            description="Scale the app window without changing saved font sizes"
          >
            <div
              className={`grid h-8 ${SETTINGS_CONTROL_WIDTH_CLASS} grid-cols-[2rem_minmax(0,1fr)_2rem] items-center overflow-hidden rounded-lg border border-transparent bg-foreground/5 text-foreground`}
            >
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Zoom out"
                disabled={!canDecreaseZoom}
                className="h-8 w-8 rounded-none text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
                onClick={() => setPreference("windowZoomId", stepWindowZoomId(windowZoomId, -1))}
              >
                <Minus className="size-3.5" />
              </Button>
              <div className="flex h-8 min-w-16 items-center justify-center border-x border-border-light px-3 text-sm font-[430] leading-4 text-foreground">
                {WINDOW_ZOOM_LABELS[windowZoomId]}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Zoom in"
                disabled={!canIncreaseZoom}
                className="h-8 w-8 rounded-none text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
                onClick={() => setPreference("windowZoomId", stepWindowZoomId(windowZoomId, 1))}
              >
                <Plus className="size-3.5" />
              </Button>
            </div>
          </SettingsCardRow>

          <SettingsCardRow
            label="UI font size"
            description="Scale app and chat text"
          >
            <SettingsMenu
              label={UI_FONT_SIZE_LABELS[uiFontSizeId]}
              className={SETTINGS_CONTROL_WIDTH_CLASS}
              menuClassName={SETTINGS_CONTROL_MENU_CLASS}
              groups={[{
                id: "ui-font-size",
                options: UI_FONT_SIZE_OPTIONS.map((option) => ({
                  id: option.id,
                  label: option.label,
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
              className={SETTINGS_CONTROL_WIDTH_CLASS}
              menuClassName={SETTINGS_CONTROL_MENU_CLASS}
              groups={[{
                id: "readable-code-font-size",
                options: READABLE_CODE_FONT_SIZE_OPTIONS.map((option) => ({
                  id: option.id,
                  label: option.label,
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
      <h2 className="text-base font-medium text-foreground">{title}</h2>
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
