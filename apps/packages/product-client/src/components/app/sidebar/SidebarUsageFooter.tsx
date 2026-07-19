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
} from "#product/components/app/sidebar/SidebarConsumptionCard";
import { useProductAuthStatus } from "#product/hooks/auth/facade/use-product-auth";
import { useAppCapabilities } from "#product/hooks/capabilities/derived/use-app-capabilities";

/** Capability-gated usage concern with independently focusable Compute/LLM rings. */
export function SidebarUsageFooter() {
  const navigate = useNavigate();
  const authStatus = useProductAuthStatus();
  const capabilities = useAppCapabilities();
  const enabled = authStatus === "authenticated" && capabilities.usageMeteringEnabled;
  const usageQuery = useUsageSummary(undefined, enabled);

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
  const canTopUp = state.kind === "ready"
    && state.usageSummary.canSelfServeTopUp
    && capabilities.billingEnabled;

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
          onTopUp={canTopUp
            ? () => {
              navigate("/settings?section=billing");
              close();
            }
            : undefined}
          onBilling={capabilities.billingEnabled
            ? () => {
              navigate("/settings?section=billing");
              close();
            }
            : undefined}
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
