import { useQuery } from "@tanstack/react-query";
import type { BillingPlanInfo } from "@/lib/integrations/cloud/client";
import { ProliferateClientError } from "@/lib/integrations/cloud/client";
import { getCloudBillingPlan } from "@/lib/integrations/cloud/billing";
import { captureTelemetryException } from "@/lib/integrations/telemetry/client";
import { useAppCapabilities } from "@/hooks/capabilities/use-app-capabilities";
import { useCloudAvailabilityState } from "@/hooks/cloud/use-cloud-availability-state";
import { cloudBillingKey } from "./query-keys";

function hasUsableBillingPlan(
  billingPlan: BillingPlanInfo | null | undefined,
): billingPlan is BillingPlanInfo {
  if (!billingPlan) return false;

  return (
    typeof billingPlan.billingMode === "string"
    && typeof billingPlan.isUnlimited === "boolean"
    && typeof billingPlan.overQuota === "boolean"
    && typeof billingPlan.startBlocked === "boolean"
    && typeof billingPlan.activeSpendHold === "boolean"
    && Number.isFinite(billingPlan.usedSandboxHours)
    && Number.isFinite(billingPlan.concurrentSandboxLimit)
    && Number.isFinite(billingPlan.activeSandboxCount)
    && (billingPlan.remainingSandboxHours === null
      || Number.isFinite(billingPlan.remainingSandboxHours))
    && (billingPlan.freeSandboxHours === null
      || Number.isFinite(billingPlan.freeSandboxHours))
  );
}

export function useCloudBilling() {
  const { billingEnabled } = useAppCapabilities();
  const { cloudActive } = useCloudAvailabilityState();
  const billingAccessible = billingEnabled && cloudActive;

  return useQuery<BillingPlanInfo | null>({
    meta: {
      telemetryHandled: true,
    },
    queryKey: cloudBillingKey(),
    enabled: billingAccessible,
    placeholderData: null,
    queryFn: async () => {
      try {
        const billingPlan = await getCloudBillingPlan();
        if (!hasUsableBillingPlan(billingPlan)) {
          captureTelemetryException(
            new Error("Received malformed billing plan payload"),
            {
              tags: {
                action: "validate_billing_plan",
                domain: "cloud_billing",
                route: "settings",
              },
              extras: {
                billing_plan: billingPlan,
              },
            },
          );
          return null;
        }
        return billingPlan;
      } catch (error) {
        if (error instanceof ProliferateClientError && error.status === 401) {
          return null;
        }
        captureTelemetryException(error, {
          tags: {
            action: "fetch_billing_plan",
            domain: "cloud_billing",
            route: "settings",
          },
        });
        throw error;
      }
    },
  });
}
