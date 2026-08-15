import { Button } from "#product/primitives/Button";
import { SettingsEmptyState } from "#product/primitives/patterns/settings/SettingsEmptyState";
import { PageHeader } from "#product/primitives/patterns/PageHeader";
import { SettingsPageBody } from "#product/primitives/patterns/settings/SettingsPageBody";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import { CAPABILITY_COPY } from "#product/copy/capabilities/capability-copy";
import { CLOUD_SETUP_DOCS_URL } from "#product/config/capabilities";

export function CloudUnavailablePane() {
  const { openExternal } = useProductHost().links;

  return (
    <SettingsPageBody>
      <PageHeader
        variant="flat"
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
    </SettingsPageBody>
  );
}
