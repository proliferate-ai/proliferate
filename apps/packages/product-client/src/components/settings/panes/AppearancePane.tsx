import type { CSSProperties } from "react";
import { SettingsSection } from "#product/components/patterns/SettingsSection";
import { SettingsRow } from "#product/components/patterns/SettingsRow";
import { SettingsMenu } from "#product/primitives/patterns/SettingsMenu";
import { SettingsPageHeader } from "#product/components/patterns/SettingsPageHeader";
import { Button } from "#product/primitives/Button";
import { DiffViewer } from "#product/components/content/ui/DiffViewer";
import { ThemePreviewCards } from "#product/components/settings/panes/ThemePreviewCards";
import { UserMessage } from "#product/components/workspace/chat/transcript/UserMessage";
import { AssistantMessage } from "#product/components/workspace/chat/transcript/AssistantMessage";
import { Minus, Plus } from "#product/primitives/icons/core";
import { Switch } from "#product/primitives/Switch";
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
import { useColorMode } from "#product/hooks/theme/workflows/use-theme-preferences";
import { useUserPreferencesStore } from "#product/stores/preferences/user-preferences-store";

/**
 * Rows on this pane sit inside bordered panels rather than flat on the page.
 * Everywhere else in Settings a flat list is right, because the whole pane is
 * one list; here the pane alternates between controls and previews, and the
 * panel is what tells a reader which of the two they are looking at.
 */
const PANEL_CLASS = "rounded-xl border border-border bg-card px-4";
/**
 * Preview panels deliberately do NOT take `bg-card`. A preview's job is to
 * show what a surface looks like in the app, and the app draws transcripts and
 * diffs on the page background — tinting them card-gray would make the preview
 * lie about the thing it previews.
 */
const PREVIEW_PANEL_CLASS = "overflow-hidden rounded-xl border border-border bg-background";
/** Narrower than the shared settings control width: these are short values. */
const CONTROL_WIDTH_CLASS = "w-40";

/**
 * The previews below are the point of this pane, so they are the real
 * renderers with canned content — not lookalike markup. `DiffViewer` brings the
 * product's own syntax theme, row tints, and change gutters; `UserMessage` and
 * `AssistantMessage` bring the transcript's own bubble and prose treatment. A
 * hand-built imitation would drift from the real thing the first time either
 * was restyled, which is the exact failure a preview exists to prevent.
 *
 * Neither needs wiring to the font-size settings: both resolve their sizes from
 * the same `--text-message` and readable-code custom properties the controls
 * below write, so changing a setting re-renders them for free.
 */
const WORKSPACE_PREVIEW_PATCH = [
  "@@ -1,5 +1,5 @@",
  " const ws: Workspace = {",
  "-  runtime: \"local\",",
  "-  branch: \"main\",",
  "-  agents: 2,",
  "+  runtime: \"cloud\",",
  "+  branch: \"pablo/ui\",",
  "+  agents: 4,",
  " };",
].join("\n");

const CHAT_PREVIEW_PROMPT = "Move this workspace to the cloud and keep my branch.";
const CHAT_PREVIEW_RESPONSE =
  "Moving the workspace to a cloud sandbox now — your branch `pablo/ui` comes along with changes and history intact.";

/**
 * The split viewer inherits its plane from `--diff-view-surface`, which is
 * normally supplied by the diff card that hosts it. This pane hosts it
 * directly, so it names the plane itself instead of letting the variable
 * resolve to nothing and paint a transparent gutter.
 */
const PREVIEW_DIFF_STYLE = {
  "--diff-view-surface": "var(--color-background)",
} as CSSProperties;

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
    <section className="flex flex-col gap-8">
      <SettingsPageHeader title="Appearance" />

      <SettingsSection title="Theme">
        <ThemePreviewCards value={mode} onChange={setMode} />
      </SettingsSection>

      <SettingsSection title="Code preview">
        <div className={PREVIEW_PANEL_CLASS} style={PREVIEW_DIFF_STYLE}>
          <DiffViewer
            patch={WORKSPACE_PREVIEW_PATCH}
            filePath="workspace.ts"
            layout="split"
            wrapLongLines
            className="py-2"
            // The preview is a fixed six-line snippet that always fits, so it
            // must not also behave like a scroll container: a nested scroller
            // here would swallow the settings page's own wheel events.
            overscrollBehavior="auto"
            chainVerticalWheel
          />
        </div>
      </SettingsSection>

      <SettingsSection title="Chat preview">
        <div className={`${PREVIEW_PANEL_CLASS} flex flex-col gap-6 px-4 py-4`}>
          <UserMessage sessionId={null} content={CHAT_PREVIEW_PROMPT} />
          <AssistantMessage content={CHAT_PREVIEW_RESPONSE} animateReveal={false} />
        </div>
      </SettingsSection>

      <SettingsSection title="Preferences">
        <div className={PANEL_CLASS}>
          <SettingsRow
            label="Window zoom"
            description="Zoom everything in the window, like browser zoom. Font size settings are unaffected."
          >
            <div
              className={`flex h-8 ${CONTROL_WIDTH_CLASS} items-center overflow-hidden rounded-lg bg-surface-control text-foreground`}
            >
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Zoom out"
                disabled={!canDecreaseZoom}
                className="h-8 w-8 shrink-0 rounded-none text-muted-foreground hover:bg-hover active:bg-active hover:text-foreground"
                onClick={() => setPreference("windowZoomId", stepWindowZoomId(windowZoomId, -1))}
              >
                <Minus className="icon-paired" />
              </Button>
              <div className="flex h-8 flex-1 items-center justify-center border-x border-border-light text-ui font-medium text-foreground">
                {WINDOW_ZOOM_LABELS[windowZoomId]}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Zoom in"
                disabled={!canIncreaseZoom}
                className="h-8 w-8 shrink-0 rounded-none text-muted-foreground hover:bg-hover active:bg-active hover:text-foreground"
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
              menuClassName={CONTROL_WIDTH_CLASS}
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
              menuClassName={CONTROL_WIDTH_CLASS}
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
        </div>
      </SettingsSection>

      <SettingsSection title="Advanced">
        <div className={PANEL_CLASS}>
          <SettingsRow
            label="Transparent chrome"
            description="Use glass treatment for workspace headers and tab bars"
          >
            <Switch
              checked={transparentChromeEnabled}
              onChange={(value) => setPreference("transparentChromeEnabled", value)}
            />
          </SettingsRow>
        </div>
      </SettingsSection>
    </section>
  );
}
