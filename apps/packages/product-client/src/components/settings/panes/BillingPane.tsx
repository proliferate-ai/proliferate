import { useNavigate } from "react-router-dom";
import {
  BillingSettingsSurface,
  type BillingCheckoutReturnState,
} from "@proliferate/product-surfaces/settings/BillingSettingsSurface";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import { SettingsEmptyState } from "@proliferate/product-ui/settings/SettingsEmptyState";
import { SettingsPageHeader } from "@proliferate/product-ui/settings/SettingsPageHeader";

import { PROLIFERATE_PRICING_URL } from "#product/config/capabilities";
import { useIsAdmin } from "#product/hooks/access/cloud/organizations/use-is-admin";
import { useAppCapabilities } from "#product/hooks/capabilities/derived/use-app-capabilities";
import { useCloudAvailabilityState } from "#product/hooks/cloud/derived/use-cloud-availability-state";
import { useActiveOrganization } from "#product/hooks/organizations/facade/use-active-organization";
import {
  buildSettingsHref,
  type SettingsFocus,
} from "#product/lib/domain/settings/navigation";

export function BillingPane({ focus = {} }: { focus?: SettingsFocus }) {
  const navigate = useNavigate();
  const {
    activeOrganization,
    organizations,
    organizationsQuery,
  } = useActiveOrganization();
  const routedOrganizationId = focus.billingOwnerScope === "organization"
    ? focus.billingOrganizationId ?? null
    : null;
  const organization = routedOrganizationId
    ? organizations.find((candidate) => candidate.id === routedOrganizationId) ?? null
    : activeOrganization;
  const admin = useIsAdmin(routedOrganizationId ?? organization?.id ?? null);
  const { billingEnabled, pricing } = useAppCapabilities();
  const { cloudActive } = useCloudAvailabilityState();
  const { openExternal } = useProductHost().links;

  if (routedOrganizationId && organizationsQuery.isLoading) {
    return <BillingOwnerState loading />;
  }

  if (routedOrganizationId && !organization) {
    return <BillingOwnerState loading={false} />;
  }

  return (
    <BillingSettingsSurface
      enabled={billingEnabled && cloudActive}
      billingReturnSurface="desktop"
      organization={organization
        ? {
            id: organization.id,
            name: organization.name,
            canManageBilling: admin.isAdmin,
            loading: admin.isLoading,
          }
        : null}
      organizationLoading={organizationsQuery.isLoading || (organization ? admin.isLoading : false)}
      checkoutReturnState={checkoutReturnStateFromFocus(focus)}
      onOpenUrl={openExternal}
      onOpenPricingPage={() => openExternal(pricing.url ?? PROLIFERATE_PRICING_URL)}
      onOpenOrganizationSettings={() => {
        navigate(buildSettingsHref({ section: "organization" }));
      }}
    />
  );
}

function BillingOwnerState({ loading }: { loading: boolean }) {
  return (
    <section className="space-y-6">
      <SettingsPageHeader title="Billing" />
      <SettingsEmptyState
        title={loading ? "Loading billing owner…" : "Billing owner unavailable"}
        description={loading
          ? "Confirming the organization for this billing destination."
          : "This organization is no longer available to your account. Return to the sidebar and select an available owner."}
      />
    </section>
  );
}

function checkoutReturnStateFromFocus(
  focus: SettingsFocus,
): BillingCheckoutReturnState {
  const checkout = focus.checkout;
  return checkout === "success" || checkout === "cancel" ? checkout : null;
}
