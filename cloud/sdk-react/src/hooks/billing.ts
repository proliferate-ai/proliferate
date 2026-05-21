import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createBillingPortalSession,
  createCloudCheckoutSession,
  createRefillCheckoutSession,
  getCloudBillingPlan,
  updateOverageSettings,
  type BillingPlanInfo,
  type BillingUrlResponse,
  type CloudOwnerSelection,
  type OverageSettingsResponse,
} from "@proliferate/cloud-sdk";
import { useCloudClient } from "../context/CloudClientProvider.js";
import {
  cloudBillingKey,
  personalCloudOwnerKey,
  type CloudOwnerSelectionKey,
} from "../lib/query-keys.js";

function normalizedOwner(owner?: CloudOwnerSelection): CloudOwnerSelectionKey {
  return {
    ...personalCloudOwnerKey(),
    ownerScope: owner?.ownerScope ?? "personal",
    organizationId: owner?.organizationId ?? null,
  };
}

export function useCloudBilling(owner?: CloudOwnerSelection, enabled = true) {
  const client = useCloudClient();
  const keyOwner = normalizedOwner(owner);
  return useQuery<BillingPlanInfo>({
    queryKey: cloudBillingKey(keyOwner),
    queryFn: () => getCloudBillingPlan(keyOwner, client),
    enabled,
  });
}

export function useCloudBillingActions(owner?: CloudOwnerSelection) {
  const client = useCloudClient();
  const queryClient = useQueryClient();
  const keyOwner = normalizedOwner(owner);
  const invalidateBilling = async () => {
    await queryClient.invalidateQueries({ queryKey: cloudBillingKey(keyOwner) });
  };

  const cloudCheckout = useMutation<BillingUrlResponse>({
    mutationFn: () => createCloudCheckoutSession(keyOwner, client),
    onSuccess: invalidateBilling,
  });
  const billingPortal = useMutation<BillingUrlResponse>({
    mutationFn: () => createBillingPortalSession(keyOwner, client),
    onSuccess: invalidateBilling,
  });
  const refillCheckout = useMutation<BillingUrlResponse>({
    mutationFn: () => createRefillCheckoutSession(keyOwner, client),
    onSuccess: invalidateBilling,
  });
  const overage = useMutation<
    OverageSettingsResponse,
    Error,
    { enabled: boolean; capCentsPerSeat?: number | null }
  >({
    mutationFn: (input) => updateOverageSettings(input, keyOwner, client),
    onSuccess: invalidateBilling,
  });

  return {
    createCloudCheckout: cloudCheckout.mutateAsync,
    creatingCloudCheckout: cloudCheckout.isPending,
    createBillingPortal: billingPortal.mutateAsync,
    creatingBillingPortal: billingPortal.isPending,
    createRefillCheckout: refillCheckout.mutateAsync,
    creatingRefillCheckout: refillCheckout.isPending,
    updateOverageEnabled: overage.mutateAsync,
    updatingOverage: overage.isPending,
  };
}
