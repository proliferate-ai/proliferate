import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BillingPlanInfo, BillingUrlResponse } from "@/lib/integrations/cloud/client";
import { ProliferateClientError } from "@/lib/integrations/cloud/client";
import {
  createBillingPortalSession,
  createCloudCheckoutSession,
  createRefillCheckoutSession,
  getCloudBillingPlan,
  updateOverageSettings,
} from "@/lib/integrations/cloud/billing";
import { captureTelemetryException } from "@/lib/integrations/telemetry/client";
import { useAppCapabilities } from "@/hooks/capabilities/use-app-capabilities";
import { useCloudAvailabilityState } from "@/hooks/cloud/use-cloud-availability-state";
import { workspaceCollectionsScopeKey } from "@/hooks/workspaces/query-keys";
import { openExternal } from "@/platform/tauri/shell";
import { useHarnessStore } from "@/stores/sessions/harness-store";
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
    && typeof billingPlan.isPaidCloud === "boolean"
    && typeof billingPlan.paymentHealthy === "boolean"
    && typeof billingPlan.overageEnabled === "boolean"
    && Number.isFinite(billingPlan.usedSandboxHours)
    && (billingPlan.concurrentSandboxLimit === null
      || Number.isFinite(billingPlan.concurrentSandboxLimit))
    && Number.isFinite(billingPlan.activeSandboxCount)
    && (billingPlan.hostedInvoiceUrl === null
      || billingPlan.hostedInvoiceUrl === undefined
      || typeof billingPlan.hostedInvoiceUrl === "string")
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
    refetchOnWindowFocus: true,
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

export function useCloudBillingActions() {
  const queryClient = useQueryClient();
  const runtimeUrl = useHarnessStore((state) => state.runtimeUrl);

  async function invalidateCloudBillingState() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: cloudBillingKey() }),
      queryClient.invalidateQueries({
        queryKey: workspaceCollectionsScopeKey(runtimeUrl),
      }),
    ]);
  }

  async function openBillingUrl(response: BillingUrlResponse) {
    await openExternal(response.url);
    await invalidateCloudBillingState();
  }

  const cloudCheckoutMutation = useMutation({
    mutationFn: createCloudCheckoutSession,
    onSuccess: openBillingUrl,
    onError: (error) => {
      captureTelemetryException(error, {
        tags: {
          action: "create_cloud_checkout",
          domain: "cloud_billing",
          route: "settings",
        },
      });
    },
  });

  const portalMutation = useMutation({
    mutationFn: createBillingPortalSession,
    onSuccess: openBillingUrl,
    onError: (error) => {
      captureTelemetryException(error, {
        tags: {
          action: "create_billing_portal",
          domain: "cloud_billing",
          route: "settings",
        },
      });
    },
  });

  const refillMutation = useMutation({
    mutationFn: createRefillCheckoutSession,
    onSuccess: openBillingUrl,
    onError: (error) => {
      captureTelemetryException(error, {
        tags: {
          action: "create_refill_checkout",
          domain: "cloud_billing",
          route: "settings",
        },
      });
    },
  });

  const overageMutation = useMutation({
    mutationFn: updateOverageSettings,
    onSuccess: invalidateCloudBillingState,
    onError: (error) => {
      captureTelemetryException(error, {
        tags: {
          action: "update_overage_settings",
          domain: "cloud_billing",
          route: "settings",
        },
      });
    },
  });

  return {
    createCloudCheckout: cloudCheckoutMutation.mutateAsync,
    createBillingPortal: portalMutation.mutateAsync,
    createRefillCheckout: refillMutation.mutateAsync,
    updateOverageEnabled: overageMutation.mutateAsync,
    creatingCloudCheckout: cloudCheckoutMutation.isPending,
    creatingBillingPortal: portalMutation.isPending,
    creatingRefillCheckout: refillMutation.isPending,
    updatingOverage: overageMutation.isPending,
  };
}
