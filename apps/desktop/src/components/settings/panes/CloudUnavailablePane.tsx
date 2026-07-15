import { Button } from "@proliferate/ui/primitives/Button";
import { SettingsEmptyState } from "@proliferate/product-ui/settings/SettingsEmptyState";
import { SettingsPageHeader } from "@proliferate/product-ui/settings/SettingsPageHeader";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import { CAPABILITY_COPY } from "@/copy/capabilities/capability-copy";
import { CLOUD_SETUP_DOCS_URL } from "@/config/capabilities";

export function CloudUnavailablePane() {
  const { openExternal } = useProductHost().links;

  return (
    <section className="space-y-6">
      <SettingsPageHeader
        title="Cloud"
        description={CAPABILITY_COPY.cloudDisabledDescription}
      />

      <SettingsEmptyState
        title="Cloud is unavailable right now"
        description={CAPABILITY_COPY.cloudDisabledDetails}
        action={
          <Button
            type="button"
            variant="secondary"
            onClick={() => { void openExternal(CLOUD_SETUP_DOCS_URL); }}
            className="w-fit"
          >
            {CAPABILITY_COPY.cloudDocsLabel}
          </Button>
        }
      />
    </section>
  );
}
