import type { FC } from "react";
import { SettingsSection } from "@proliferate/product-ui/patterns/SettingsSection";
import { SETTINGS_CONTROL_WIDTH_CLASS, SettingsRow } from "@proliferate/product-ui/patterns/SettingsRow";
import { SettingsMenu } from "@proliferate/ui/patterns/SettingsMenu";
import { SettingsPageHeader } from "@proliferate/product-ui/patterns/SettingsPageHeader";
import { Button } from "@proliferate/ui/primitives/Button";
import { SegmentedControl } from "@proliferate/ui/primitives/SegmentedControl";
import { AppearanceSampleBlock } from "#product/components/settings/panes/AppearanceSampleBlock";
import { Minus, Monitor, Moon, Plus, Sun } from "@proliferate/ui/icons";
import { Switch } from "@proliferate/ui/primitives/Switch";
import {
  READABLE_CODE_FONT_SIZE_LABELS,
  READABLE_CODE_FONT_SIZE_OPTIONS,
  UI_FONT_SIZE_LABELS,
  UI_FONT_SIZE_OPTIONS,
  WINDOW_ZOOM_LABELS,
} from "#product/lib/domain/preferences/appearance-presentation";
import {
  stepWindowZoomId,
  WINDOW_ZOOM_IDS,
} from "#product/lib/domain/preferences/appearance";
import { COLOR_MODES, type ColorMode } from "#product/config/theme";
import { useColorMode } from "#product/hooks/theme/workflows/use-theme-preferences";
import { useUserPreferencesStore } from "#product/stores/preferences/user-preferences-store";

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

export function AppearancePane() {
  const [mode, setMode] = useColorMode();
  const transparentChromeEnabled = useUserPreferencesStore((state) => state.transparentChromeEnabled);
  const uiFontSizeId = useUserPreferencesStore((state) => state.uiFontSizeId);
  const readableCodeFontSizeId = useUserPreferencesStore((state) => state.readableCodeFontSizeId);
  const windowZoomId = useUserPreferencesStore((state) => state.windowZoomId);
  const setPreference = useUserPreferencesStore((state) => state.set);
  const canDecreaseZoom = windowZoomId !== WINDOW_ZOOM_IDS[0];
  const canIncreaseZoom = windowZoomId !== WINDOW_ZOOM_IDS[WINDOW_ZOOM_IDS.length - 1];

  return (
    <section className="space-y-6">
      <SettingsPageHeader title="Appearance" />

      <SettingsSection title="Preferences">
        <SettingsRow
          label="Mode"
          description="Light, dark, or follow the system setting"
        >
          <SegmentedControl
            ariaLabel="Color mode"
            value={mode}
            items={COLOR_MODES.map((candidateMode) => {
              const Icon = MODE_ICONS[candidateMode];
              return {
                id: candidateMode,
                label: MODE_LABELS[candidateMode],
                icon: <Icon aria-hidden="true" />,
              };
            })}
            onChange={setMode}
          />
        </SettingsRow>

        {/* Stepper sits on the app's 28px control tier, matching the selects below
            and the composer's controls. Plain `h-7` for now: the semantic
            control-height tier utility is landing in the design layer, and this
            converts to it without changing the rendered height. */}
        <SettingsRow
          label="Window zoom"
          description="Zoom everything in the window, like browser zoom. Font size settings are unaffected."
        >
          <div
            className={`grid h-7 ${SETTINGS_CONTROL_WIDTH_CLASS} grid-cols-[1.75rem_minmax(0,1fr)_1.75rem] items-center overflow-hidden rounded-lg border border-transparent bg-foreground/5 text-foreground`}
          >
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Zoom out"
              disabled={!canDecreaseZoom}
              className="h-7 w-7 rounded-none text-muted-foreground hover:bg-hover active:bg-active hover:text-foreground"
              onClick={() => setPreference("windowZoomId", stepWindowZoomId(windowZoomId, -1))}
            >
              <Minus className="icon-paired" />
            </Button>
            <div className="flex h-7 min-w-16 items-center justify-center border-x border-border-light px-3 text-ui font-medium text-foreground">
              {WINDOW_ZOOM_LABELS[windowZoomId]}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Zoom in"
              disabled={!canIncreaseZoom}
              className="h-7 w-7 rounded-none text-muted-foreground hover:bg-hover active:bg-active hover:text-foreground"
              onClick={() => setPreference("windowZoomId", stepWindowZoomId(windowZoomId, 1))}
            >
              <Plus className="icon-paired" />
            </Button>
          </div>
        </SettingsRow>

        <SettingsRow
          label="UI font size"
          description="Scale app and chat text"
        >
          <SettingsMenu
            label={UI_FONT_SIZE_LABELS[uiFontSizeId]}
            className={SETTINGS_CONTROL_WIDTH_CLASS}
            menuClassName={SETTINGS_CONTROL_WIDTH_CLASS}
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
        </SettingsRow>

        <SettingsRow
          label="Code font size"
          description="Scale editors, diffs, and code blocks"
        >
          <SettingsMenu
            label={READABLE_CODE_FONT_SIZE_LABELS[readableCodeFontSizeId]}
            className={SETTINGS_CONTROL_WIDTH_CLASS}
            menuClassName={SETTINGS_CONTROL_WIDTH_CLASS}
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
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="Advanced">
        <SettingsRow
          label="Transparent chrome"
          description="Use glass treatment for workspace headers and tab bars"
        >
          <Switch
            checked={transparentChromeEnabled}
            onChange={(value) => setPreference("transparentChromeEnabled", value)}
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection
        title="Sample"
        description="How text and code read with the settings above."
      >
        <AppearanceSampleBlock />
      </SettingsSection>
    </section>
  );
}
