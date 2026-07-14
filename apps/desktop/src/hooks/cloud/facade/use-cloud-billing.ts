import { useCallback } from "react";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import type { BillingUrlResponse } from "@/lib/access/cloud/client";
import type { CloudOwnerSelection } from "@/lib/domain/cloud/billing";
import {
  useCloudBillingMutations,
  useCloudBillingQuery,
  useInvalidateCloudBillingState,
} from "@/hooks/access/cloud/use-cloud-billing";
import { useAppCapabilities } from "@/hooks/capabilities/derived/use-app-capabilities";
import { useCloudAvailabilityState } from "@/hooks/cloud/derived/use-cloud-availability-state";
import { useAuthStore } from "@/stores/auth/auth-store";

function billingOwnerKey(owner?: CloudOwnerSelection) {
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
  const ownerKey = billingOwnerKey(owner);
  const billingAccessible = billingEnabled
    && (
      ownerKey.ownerScope === "organization"
        ? authStatus === "authenticated" && Boolean(ownerKey.organizationId)
        : cloudActive
    );

  return useCloudBillingQuery(owner, {
    enabled: billingAccessible && (options?.enabled ?? true),
  });
}

export function useCloudBillingActions(owner?: CloudOwnerSelection) {
  const { openExternal } = useProductHost().links;
  const billingMutations = useCloudBillingMutations(owner);
  const invalidateCloudBillingState = useInvalidateCloudBillingState(owner);

  const openBillingUrl = useCallback(async (response: BillingUrlResponse) => {
    await openExternal(response.url);
    await invalidateCloudBillingState();
  }, [invalidateCloudBillingState, openExternal]);

  const createCloudCheckout = useCallback(async () => {
    const response = await billingMutations.createCloudCheckout();
    await openBillingUrl(response);
    return response;
  }, [billingMutations.createCloudCheckout, openBillingUrl]);

  const createBillingPortal = useCallback(async () => {
    const response = await billingMutations.createBillingPortal();
    await openBillingUrl(response);
    return response;
  }, [billingMutations.createBillingPortal, openBillingUrl]);

  const createRefillCheckout = useCallback(async () => {
    const response = await billingMutations.createRefillCheckout();
    await openBillingUrl(response);
    return response;
  }, [billingMutations.createRefillCheckout, openBillingUrl]);

  const updateOverageEnabled = useCallback(async (
    input: { enabled: boolean; capCentsPerSeat?: number | null },
  ) => {
    const response = await billingMutations.updateOverageEnabled(input);
    await invalidateCloudBillingState();
    return response;
  }, [billingMutations.updateOverageEnabled, invalidateCloudBillingState]);

  return {
    createCloudCheckout,
    createBillingPortal,
    createRefillCheckout,
    updateOverageEnabled,
    creatingCloudCheckout: billingMutations.creatingCloudCheckout,
    creatingBillingPortal: billingMutations.creatingBillingPortal,
    creatingRefillCheckout: billingMutations.creatingRefillCheckout,
    updatingOverage: billingMutations.updatingOverage,
  };
}
