import { Button } from "#product/primitives/Button";
import { SettingsEmptyState } from "#product/components/patterns/SettingsEmptyState";
import { SettingsPageHeader } from "#product/components/patterns/SettingsPageHeader";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import { CAPABILITY_COPY } from "#product/copy/capabilities/capability-copy";
import { CLOUD_SETUP_DOCS_URL } from "#product/config/capabilities";

export function CloudAuthUnavailablePane() {
  const { openExternal } = useProductHost().links;

  return (
    <section className="space-y-6">
      <SettingsPageHeader
        title="Cloud"
        description={CAPABILITY_COPY.cloudAuthUnavailableDescription}
      />

      <SettingsEmptyState
        title="GitHub sign-in is unavailable"
        description={CAPABILITY_COPY.cloudAuthUnavailableDetails}
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
