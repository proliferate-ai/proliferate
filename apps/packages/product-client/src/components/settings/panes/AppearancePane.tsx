import { SettingsSection } from "#product/primitives/patterns/settings/SettingsSection";
import { SettingsRow } from "#product/primitives/patterns/settings/SettingsRow";
import { SettingsMenu } from "#product/primitives/patterns/settings/SettingsMenu";
import { PageHeader } from "#product/primitives/patterns/PageHeader";
import { SettingsPageBody } from "#product/primitives/patterns/settings/SettingsPageBody";
import { Card } from "#product/primitives/patterns/Card";
import { Button } from "#product/primitives/Button";
import { AppearanceCodePreview } from "#product/components/settings/panes/AppearanceCodePreview";
import { ThemePreviewCards } from "#product/components/settings/panes/ThemePreviewCards";
import { UserMessage } from "#product/components/workspace/chat/transcript/UserMessage";
import { AssistantMessage } from "#product/components/workspace/chat/transcript/AssistantMessage";
import { Minus, Plus } from "#product/primitives/icons/core";
import { Switch } from "#product/primitives/Switch";
import {
  READABLE_CODE_FONT_SIZE_LABELS,
  READABLE_CODE_FONT_SIZE_OPTIONS,
  readableCodeFontSizeDetail,
  UI_FONT_SIZE_LABELS,
  UI_FONT_SIZE_OPTIONS,
  WINDOW_ZOOM_LABELS,
} from "#product/lib/domain/preferences/appearance-presentation";
import {
  stepWindowZoomId,
  WINDOW_ZOOM_IDS,
} from "#product/lib/domain/preferences/appearance";
import { useColorMode } from "#product/hooks/theme/workflows/use-theme-preferences";
import { useUserPreferencesStore } from "#product/stores/preferences/user-preferences-store";

/**
 * Preview sections use `surface="plain"` and the preview shells below force
 * `bg-background` onto `Card`'s `opaque` surface — their content sits on the
 * real app background, never inside the wash card. A preview's job is to
 * show what a surface looks like in the app, and the app draws transcripts
 * and diffs on the page background; tinting them card-gray would make the
 * preview lie about the thing it previews. This is a deliberate divergence
 * from `Card`'s default fills (`bg-card` for `opaque`, no plain-background
 * option), documented rather than force-fit.
 */
/** Narrower than the shared settings control width: these are short values. */
const CONTROL_WIDTH_CLASS = "w-40";

/**
 * The chat preview is the real transcript renderers with canned content — a
 * hand-built imitation would drift from the real thing the first time they
 * were restyled. The code preview is the opposite call: `AppearanceCodePreview`
 * is a bespoke five-line drawing, because the real DiffViewer carries review
 * chrome (file header, context shading, scroll containment) that reads as
 * noise in a settings pane. Both resolve their sizes from the same
 * `--text-message` and readable-code custom properties the controls below
 * write, so changing a setting re-renders them for free.
 */
const CHAT_PREVIEW_PROMPT = "Move this workspace to the cloud and keep my branch.";
const CHAT_PREVIEW_RESPONSE =
  "Moving the workspace to a cloud sandbox now — your branch `pablo/ui` comes along with changes and history intact.";

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
    <SettingsPageBody>
      <PageHeader variant="flat" title="Appearance" />

      <SettingsSection title="Theme" surface="plain">
        <ThemePreviewCards value={mode} onChange={setMode} />
      </SettingsSection>

      <SettingsSection title="Code preview" surface="plain">
        <Card surface="opaque" className="bg-background">
          <AppearanceCodePreview />
        </Card>
      </SettingsSection>

      <SettingsSection title="Chat preview" surface="plain">
        <Card surface="opaque" className="flex flex-col gap-6 bg-background px-4 py-4">
          <UserMessage sessionId={null} content={CHAT_PREVIEW_PROMPT} />
          <AssistantMessage content={CHAT_PREVIEW_RESPONSE} animateReveal={false} />
        </Card>
      </SettingsSection>

      <SettingsSection title="Preferences">
        <SettingsRow
          label="Window zoom"
          description="Zoom everything in the window, like browser zoom. Font size settings are unaffected."
        >
          <div
            className={`flex h-7 ${CONTROL_WIDTH_CLASS} items-center overflow-hidden rounded-lg bg-surface-control text-foreground`}
          >
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Zoom out"
              disabled={!canDecreaseZoom}
              className="h-7 w-7 shrink-0 rounded-none"
              onClick={() => setPreference("windowZoomId", stepWindowZoomId(windowZoomId, -1))}
            >
              <Minus className="icon-paired" />
            </Button>
            <div className="flex h-7 flex-1 items-center justify-center border-x border-border-light text-ui font-medium text-foreground">
              {WINDOW_ZOOM_LABELS[windowZoomId]}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Zoom in"
              disabled={!canIncreaseZoom}
              className="h-7 w-7 shrink-0 rounded-none"
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
            className={CONTROL_WIDTH_CLASS}
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
            className={CONTROL_WIDTH_CLASS}
            groups={[{
              id: "readable-code-font-size",
              options: READABLE_CODE_FONT_SIZE_OPTIONS.map((option) => ({
                id: option.id,
                label: option.label,
                detail: readableCodeFontSizeDetail(option.id, uiFontSizeId),
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
    </SettingsPageBody>
  );
}
