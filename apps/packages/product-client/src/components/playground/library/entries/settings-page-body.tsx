import { PageHeader } from "#product/primitives/patterns/PageHeader";
import { SettingsGroup } from "#product/primitives/patterns/settings/SettingsGroup";
import { SettingsPageBody } from "#product/primitives/patterns/settings/SettingsPageBody";
import type { LibraryEntry } from "../types";

/**
 * The scaffold's whole job is the gap between top-level children, so the demo
 * has to show more than one: a flat page header plus two wash cards, which is
 * the shape of a real settings pane. Fixture props and no state, per the
 * self-contained registry-demo rule.
 */
function SettingsPageBodyDemo() {
  return (
    <SettingsPageBody>
      <PageHeader
        variant="flat"
        title="General"
        description="Preferences that apply everywhere in the app."
      />
      <SettingsGroup label="Startup">
        <div className="flex items-center gap-3.5 px-3.5 py-[13px] text-ui text-foreground">
          Reopen last workspace
        </div>
        <div className="flex items-center gap-3.5 px-3.5 py-[13px] text-ui text-foreground">
          Check for updates on launch
        </div>
      </SettingsGroup>
      <SettingsGroup label="Advanced">
        <div className="flex items-center gap-3.5 px-3.5 py-[13px] text-ui text-foreground">
          Developer mode
        </div>
      </SettingsGroup>
    </SettingsPageBody>
  );
}

/**
 * Registry row for the settings area scaffold. Kept in its own module so the
 * vocabulary PR's parallel authors do not all edit `patterns.tsx`; the
 * integrator splices this into `PATTERNS_TIER`.
 */
export const SETTINGS_PAGE_BODY_ENTRY: LibraryEntry = {
  name: "SettingsPageBody",
  subpath: "#product/primitives/patterns/settings/SettingsPageBody",
  render: SettingsPageBodyDemo,
};
