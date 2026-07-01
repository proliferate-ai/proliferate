import { Button } from "@proliferate/ui/primitives/Button";
import { SettingsPageHeader } from "@/components/settings/shared/SettingsPageHeader";
import { CAPABILITY_COPY } from "@/copy/capabilities/capability-copy";
import { CLOUD_SETUP_DOCS_URL } from "@/config/capabilities";
import { useTauriShellActions } from "@/hooks/access/tauri/use-shell-actions";

export function CloudUnavailablePane() {
  const { openExternal } = useTauriShellActions();

  return (
    <section className="space-y-6">
      <SettingsPageHeader
        title="Cloud"
        description={CAPABILITY_COPY.cloudDisabledDescription}
      />

      <div className="flex min-h-[280px] flex-col items-center justify-center gap-2 px-6 py-16 text-center">
        <div className="text-sm font-medium text-foreground">
          Cloud is unavailable right now.
        </div>
        <p className="max-w-[48ch] text-xs leading-[1.45] text-muted-foreground">
          {CAPABILITY_COPY.cloudDisabledDetails}
        </p>
        <div className="mt-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => { void openExternal(CLOUD_SETUP_DOCS_URL); }}
            className="w-fit"
          >
            {CAPABILITY_COPY.cloudDocsLabel}
          </Button>
        </div>
      </div>
    </section>
  );
}
