import { Button } from "#product/primitives/Button";
import { SettingsEmptyState } from "#product/primitives/patterns/settings/SettingsEmptyState";
import { PageHeader } from "#product/primitives/patterns/PageHeader";
import { SettingsPageBody } from "#product/primitives/patterns/settings/SettingsPageBody";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import { CAPABILITY_COPY } from "#product/copy/capabilities/capability-copy";
import { CLOUD_SETUP_DOCS_URL } from "#product/config/capabilities";

/**
 * Shown to a SIGNED-IN user on a deployment whose operator has not configured
 * cloud compute (contract.cloudWorkspaces off / operator-incomplete). This is
 * the truthful operator-configuration state — never a "Sign in" CTA, because
 * the user is already signed in and only an operator can repair it (the same
 * misleading-user-CTA class PR2-GATING-01 eliminates elsewhere).
 */
export function CloudNotConfiguredPane() {
  const { openExternal } = useProductHost().links;

  return (
    <SettingsPageBody>
      <PageHeader
        variant="flat"
        title="Cloud"
        description={CAPABILITY_COPY.cloudNotConfiguredDescription}
      />

      <SettingsEmptyState
        title="Cloud is not configured on this deployment"
        description={CAPABILITY_COPY.cloudNotConfiguredDetails}
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
