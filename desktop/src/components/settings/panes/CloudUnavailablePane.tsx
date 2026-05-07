import { Button } from "@/components/ui/Button";
import { SettingsPageHeader } from "@/components/settings/SettingsPageHeader";
import { SettingsCard } from "@/components/settings/SettingsCard";
import { CAPABILITY_COPY } from "@/copy/capabilities/capability-copy";
import { CLOUD_SETUP_DOCS_URL } from "@/config/capabilities";
import { openExternal } from "@/platform/tauri/shell";

export function CloudUnavailablePane() {
  return (
    <section className="space-y-6">
      <SettingsPageHeader
        title="Cloud"
        description={CAPABILITY_COPY.cloudDisabledDescription}
      />

      <SettingsCard>
        <div className="space-y-4 p-4">
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">
              Cloud is unavailable right now.
            </p>
            <p className="text-sm text-muted-foreground">
              {CAPABILITY_COPY.cloudDisabledDetails}
            </p>
          </div>

          <Button
            type="button"
            variant="secondary"
            onClick={() => { void openExternal(CLOUD_SETUP_DOCS_URL); }}
            className="w-fit"
          >
            {CAPABILITY_COPY.cloudDocsLabel}
          </Button>
        </div>
      </SettingsCard>
    </section>
  );
}
