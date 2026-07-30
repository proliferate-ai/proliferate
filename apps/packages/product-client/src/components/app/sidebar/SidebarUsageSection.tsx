import { useNavigate } from "react-router-dom";
import { useUsageSummary } from "@proliferate/cloud-sdk-react";
import {
  ConsumptionCard,
  type SidebarConsumptionState,
  type SidebarConsumptionActions,
} from "#product/components/app/sidebar/SidebarConsumptionCard";
import { useProductAuthStatus } from "#product/hooks/auth/facade/use-product-auth";
import { useAppCapabilities } from "#product/hooks/capabilities/derived/use-app-capabilities";
import { useSelectedCloudOwner } from "#product/hooks/organizations/derived/use-selected-cloud-owner";
import { buildBillingSettingsHref } from "#product/lib/domain/settings/navigation";

/**
 * Capability-gated usage concern, rendered as status rows inside the account
 * menu rather than as its own footer control. Deployments without usage
 * metering render nothing at all — that empty result is the correct answer,
 * not a missing state.
 */
export function SidebarUsageSection({ onNavigate }: { onNavigate?: () => void }) {
  const navigate = useNavigate();
  const authStatus = useProductAuthStatus();
  const capabilities = useAppCapabilities();
  const usageOwner = useSelectedCloudOwner();
  const enabled = authStatus === "authenticated" && capabilities.usageMeteringEnabled;
  const usageQuery = useUsageSummary(usageOwner, enabled);

  if (!enabled) {
    return null;
  }

  const state: SidebarConsumptionState = usageQuery.data
    ? { kind: "ready", usageSummary: usageQuery.data }
    : usageQuery.isLoading
      ? { kind: "loading" }
      : {
        kind: "unavailable",
        message: "We couldn't load current usage.",
      };
  const billingHref = buildBillingSettingsHref(usageOwner);
  const openBilling = (href: string) => {
    navigate(href);
    onNavigate?.();
  };

  // The separator belongs to the section, not to its host: a gated-off
  // deployment must leave no empty banded row behind in the menu.
  return (
    <div className="border-t border-border-light py-1">
      <ConsumptionCard
        state={state}
        onRetry={state.kind === "unavailable"
          ? () => { void usageQuery.refetch(); }
          : undefined}
        actions={resolveConsumptionActions(
          state,
          capabilities.billingEnabled,
          billingHref,
          billingHref ? () => openBilling(billingHref) : undefined,
        )}
      />
    </div>
  );
}

function resolveConsumptionActions(
  state: SidebarConsumptionState,
  billingEnabled: boolean,
  billingHref: string | null,
  openBilling: (() => void) | undefined,
): SidebarConsumptionActions | undefined {
  if (state.kind !== "ready") {
    return undefined;
  }
  if (!billingEnabled) {
    return {
      kind: "unavailable",
      message: "Billing actions aren't available on this deployment.",
    };
  }
  if (!state.usageSummary.canSelfServeTopUp) {
    if (billingHref && openBilling) {
      return {
        kind: "admin-managed",
        message: "Billing is managed by your organization admins.",
        onBilling: openBilling,
      };
    }
    return {
      kind: "unavailable",
      message: "Billing for personal usage isn't available from this menu.",
    };
  }
  if (billingHref && openBilling) {
    return { kind: "billing", onBilling: openBilling };
  }
  return {
    kind: "unavailable",
    message: "Billing for personal usage isn't available from this menu.",
  };
}
