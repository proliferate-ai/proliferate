import { Button } from "@/components/ui/Button";
import { SettingsPageHeader } from "@/components/settings/shared/SettingsPageHeader";
import { SettingsCard } from "@/components/settings/shared/SettingsCard";
import { CAPABILITY_COPY } from "@/copy/capabilities/capability-copy";
import { CLOUD_SETUP_DOCS_URL } from "@/config/capabilities";
import { useTauriShellActions } from "@/hooks/access/tauri/use-shell-actions";

export function CloudAuthUnavailablePane() {
  const { openExternal } = useTauriShellActions();

  return (
    <section className="space-y-6">
      <SettingsPageHeader
        title="Cloud"
        description={CAPABILITY_COPY.cloudAuthUnavailableDescription}
      />

      <SettingsCard>
        <div className="space-y-4 p-4">
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">
              GitHub sign-in is unavailable.
            </p>
            <p className="text-sm text-muted-foreground">
              {CAPABILITY_COPY.cloudAuthUnavailableDetails}
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
