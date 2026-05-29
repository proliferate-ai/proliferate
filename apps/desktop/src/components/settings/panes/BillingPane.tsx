import { useNavigate, useSearchParams } from "react-router-dom";
import {
  BillingSettingsSurface,
  type BillingCheckoutReturnState,
} from "@proliferate/product-surfaces/settings/BillingSettingsSurface";

import { useIsAdmin } from "@/hooks/access/cloud/organizations/use-is-admin";
import { useTauriShellActions } from "@/hooks/access/tauri/use-shell-actions";
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
  const { billingEnabled } = useAppCapabilities();
  const { cloudActive } = useCloudAvailabilityState();
  const { openExternal } = useTauriShellActions();
  const [searchParams] = useSearchParams();

  return (
    <BillingSettingsSurface
      enabled={billingEnabled && cloudActive}
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
