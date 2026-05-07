import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BillingPlanInfo, BillingUrlResponse } from "@/lib/access/cloud/client";
import { ProliferateClientError } from "@/lib/access/cloud/client";
import {
  type CloudOwnerSelection,
  createBillingPortalSession,
  createCloudCheckoutSession,
  createRefillCheckoutSession,
  getCloudBillingPlan,
  updateOverageSettings,
} from "@/lib/access/cloud/billing";
import { captureTelemetryException } from "@/lib/integrations/telemetry/client";
import { useAppCapabilities } from "@/hooks/capabilities/use-app-capabilities";
import { useCloudAvailabilityState } from "@/hooks/cloud/use-cloud-availability-state";
import { workspaceCollectionsScopeKey } from "@/hooks/workspaces/query-keys";
import { useTauriShellActions } from "@/hooks/access/tauri/use-shell-actions";
import { useAuthStore } from "@/stores/auth/auth-store";
import { useHarnessConnectionStore } from "@/stores/sessions/harness-connection-store";
import { cloudBillingKey, type CloudOwnerSelectionKey } from "@/hooks/access/cloud/query-keys";

function hasUsableBillingPlan(
  billingPlan: BillingPlanInfo | null | undefined,
): billingPlan is BillingPlanInfo {
  if (!billingPlan) return false;

  const nullableNumber = (value: unknown) => value === null || Number.isFinite(value);
  const optionalNullableString = (value: unknown) =>
    value === null || value === undefined || typeof value === "string";

  return (
    typeof billingPlan.plan === "string"
    && typeof billingPlan.billingMode === "string"
    && typeof billingPlan.proBillingEnabled === "boolean"
    && typeof billingPlan.isUnlimited === "boolean"
    && typeof billingPlan.hasUnlimitedCloudHours === "boolean"
    && typeof billingPlan.overQuota === "boolean"
    && typeof billingPlan.startBlocked === "boolean"
    && typeof billingPlan.activeSpendHold === "boolean"
    && typeof billingPlan.isPaidCloud === "boolean"
    && typeof billingPlan.paymentHealthy === "boolean"
    && typeof billingPlan.overageEnabled === "boolean"
    && Number.isFinite(billingPlan.usedSandboxHours)
    && nullableNumber(billingPlan.cloudRepoLimit)
    && Number.isFinite(billingPlan.activeCloudRepoCount)
    && nullableNumber(billingPlan.concurrentSandboxLimit)
    && Number.isFinite(billingPlan.activeSandboxCount)
    && optionalNullableString(billingPlan.hostedInvoiceUrl)
    && nullableNumber(billingPlan.remainingSandboxHours)
    && nullableNumber(billingPlan.freeSandboxHours)
    && (billingPlan.billableSeatCount === null
      || Number.isFinite(billingPlan.billableSeatCount))
    && nullableNumber(billingPlan.includedManagedCloudHours)
    && nullableNumber(billingPlan.remainingManagedCloudHours)
    && typeof billingPlan.managedCloudOverageEnabled === "boolean"
    && nullableNumber(billingPlan.managedCloudOverageCapCents)
    && Number.isFinite(billingPlan.managedCloudOverageUsedCents)
    && Number.isFinite(billingPlan.overagePricePerHourCents)
    && nullableNumber(billingPlan.activeEnvironmentLimit)
    && nullableNumber(billingPlan.repoEnvironmentLimit)
    && typeof billingPlan.byoRuntimeAllowed === "boolean"
    && typeof billingPlan.legacyCloudSubscription === "boolean"
  );
}

function billingPlanShapeDiagnostics(billingPlan: BillingPlanInfo | null | undefined) {
  if (!billingPlan) {
    return { missingFields: ["payload"], invalidFields: [] };
  }

  const requiredFields = [
    "plan",
    "billingMode",
    "proBillingEnabled",
    "isUnlimited",
    "hasUnlimitedCloudHours",
    "overQuota",
    "startBlocked",
    "activeSpendHold",
    "isPaidCloud",
    "paymentHealthy",
    "overageEnabled",
    "managedCloudOverageEnabled",
    "managedCloudOverageUsedCents",
    "overagePricePerHourCents",
    "activeEnvironmentLimit",
    "repoEnvironmentLimit",
    "byoRuntimeAllowed",
    "legacyCloudSubscription",
  ] as const;

  const missingFields = requiredFields.filter((field) => !(field in billingPlan));
  const invalidFields = Object.entries(billingPlan)
    .filter(([, value]) => value === undefined)
    .map(([field]) => field);
  return { missingFields, invalidFields };
}

function ownerKey(owner?: CloudOwnerSelection): CloudOwnerSelectionKey {
  return {
    ownerScope: owner?.ownerScope ?? "personal",
    organizationId: owner?.organizationId ?? null,
  };
}

export function useCloudBilling(
  owner?: CloudOwnerSelection,
  options?: { enabled?: boolean },
) {
  const { billingEnabled } = useAppCapabilities();
  const { cloudActive } = useCloudAvailabilityState();
  const authStatus = useAuthStore((state) => state.status);
  const billingOwnerKey = ownerKey(owner);
  const billingAccessible = billingEnabled
    && (
      billingOwnerKey.ownerScope === "organization"
        ? authStatus === "authenticated" && Boolean(billingOwnerKey.organizationId)
        : cloudActive
    );

  return useQuery<BillingPlanInfo | null>({
    meta: {
      telemetryHandled: true,
    },
    queryKey: cloudBillingKey(billingOwnerKey),
    enabled: billingAccessible && (options?.enabled ?? true),
    placeholderData: null,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      try {
        const billingPlan = await getCloudBillingPlan(owner);
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
                billing_plan_shape: billingPlanShapeDiagnostics(billingPlan),
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

export function useCloudBillingActions(owner?: CloudOwnerSelection) {
  const queryClient = useQueryClient();
  const { openExternal } = useTauriShellActions();
  const runtimeUrl = useHarnessConnectionStore((state) => state.runtimeUrl);
  const billingOwnerKey = ownerKey(owner);

  async function invalidateCloudBillingState() {
    await queryClient.invalidateQueries({ queryKey: cloudBillingKey(billingOwnerKey) });
    if (billingOwnerKey.ownerScope === "personal") {
      await queryClient.invalidateQueries({
        queryKey: workspaceCollectionsScopeKey(runtimeUrl),
      });
    }
  }

  async function openBillingUrl(response: BillingUrlResponse) {
    await openExternal(response.url);
    await invalidateCloudBillingState();
  }

  const cloudCheckoutMutation = useMutation({
    mutationFn: () => createCloudCheckoutSession(owner),
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
    mutationFn: () => createBillingPortalSession(owner),
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
    mutationFn: () => createRefillCheckoutSession(owner),
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
    mutationFn: (input: { enabled: boolean; capCentsPerSeat?: number | null }) =>
      updateOverageSettings(input, owner),
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
