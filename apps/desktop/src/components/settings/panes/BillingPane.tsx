import { useNavigate, useSearchParams } from "react-router-dom";
import {
  BillingSettingsSurface,
  type BillingCheckoutReturnState,
} from "@proliferate/product-surfaces/settings/BillingSettingsSurface";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";

import { PROLIFERATE_PRICING_URL } from "@/config/capabilities";
import { useIsAdmin } from "@/hooks/access/cloud/organizations/use-is-admin";
import { useAppCapabilities } from "@/hooks/capabilities/derived/use-app-capabilities";
import { useCloudAvailabilityState } from "@/hooks/cloud/derived/use-cloud-availability-state";
import { useActiveOrganization } from "@/hooks/organizations/facade/use-active-organization";
import { buildSettingsHref } from "@/lib/domain/settings/navigation";

export function BillingPane() {
  const navigate = useNavigate();
  const {
    activeOrganization,
    activeOrganizationId,
    organizationsQuery,
  } = useActiveOrganization();
  const admin = useIsAdmin(activeOrganizationId);
  const { billingEnabled, pricing } = useAppCapabilities();
  const { cloudActive } = useCloudAvailabilityState();
  const { openExternal } = useProductHost().links;
  const [searchParams] = useSearchParams();

  return (
    <BillingSettingsSurface
      enabled={billingEnabled && cloudActive}
      billingReturnSurface="desktop"
      organization={activeOrganization
        ? {
            id: activeOrganization.id,
            name: activeOrganization.name,
            canManageBilling: admin.isAdmin,
            loading: admin.isLoading,
          }
        : null}
      organizationLoading={organizationsQuery.isLoading || (activeOrganization ? admin.isLoading : false)}
      checkoutReturnState={checkoutReturnStateFromParams(searchParams)}
      onOpenUrl={openExternal}
      onOpenPricingPage={() => openExternal(pricing.url ?? PROLIFERATE_PRICING_URL)}
      onOpenOrganizationSettings={() => {
        navigate(buildSettingsHref({ section: "organization" }));
      }}
    />
  );
}

function checkoutReturnStateFromParams(
  searchParams: URLSearchParams,
): BillingCheckoutReturnState {
  const checkout = searchParams.get("checkout");
  return checkout === "success" || checkout === "cancel" ? checkout : null;
}
