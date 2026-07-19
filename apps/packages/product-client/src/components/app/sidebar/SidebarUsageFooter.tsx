import { useNavigate } from "react-router-dom";
import { useUsageSummary } from "@proliferate/cloud-sdk-react";
import {
  POPOVER_SURFACE_CLASS,
  PopoverButton,
} from "@proliferate/ui/primitives/PopoverButton";
import {
  ConsumptionCard,
  SidebarUsageMeterTrigger,
  type SidebarConsumptionMeter,
  type SidebarConsumptionState,
  type SidebarConsumptionActions,
} from "#product/components/app/sidebar/SidebarConsumptionCard";
import { useProductAuthStatus } from "#product/hooks/auth/facade/use-product-auth";
import { useAppCapabilities } from "#product/hooks/capabilities/derived/use-app-capabilities";
import { useSelectedCloudOwner } from "#product/hooks/organizations/derived/use-selected-cloud-owner";
import { buildBillingSettingsHref } from "#product/lib/domain/settings/navigation";

/** Capability-gated usage concern with independently focusable Compute/LLM rings. */
export function SidebarUsageFooter() {
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
  const openBilling = (href: string, close: () => void) => {
    navigate(href);
    close();
  };

  const meterPopover = (meter: SidebarConsumptionMeter) => (
    <PopoverButton
      key={meter}
      align="end"
      side="top"
      offset={8}
      trigger={<SidebarUsageMeterTrigger meter={meter} state={state} />}
      className={`w-64 ${POPOVER_SURFACE_CLASS}`}
    >
      {(close) => (
        <ConsumptionCard
          state={state}
          onRetry={state.kind === "unavailable"
            ? () => { void usageQuery.refetch(); }
            : undefined}
          actions={resolveConsumptionActions(
            state,
            capabilities.billingEnabled,
            billingHref,
            billingHref ? () => openBilling(billingHref, close) : undefined,
          )}
        />
      )}
    </PopoverButton>
  );

  return (
    <div
      role="group"
      aria-label="Usage meters"
      title="Usage"
      className="flex h-10 items-center gap-0.5 rounded-lg px-1 text-sidebar-muted-foreground hover:bg-sidebar-accent"
    >
      {meterPopover("compute")}
      {meterPopover("llm")}
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
      message: "Billing for personal usage isn't available from this sidebar.",
    };
  }
  if (billingHref && openBilling) {
    return { kind: "billing", onBilling: openBilling };
  }
  return {
    kind: "unavailable",
    message: "Billing for personal usage isn't available from this sidebar.",
  };
}
