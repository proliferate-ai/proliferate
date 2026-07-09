import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  cancelTeamCheckout,
  createBillingPortalSession,
  createCloudCheckoutSession,
  createRefillCheckoutSession,
  createTeamCheckoutSession,
  getCurrentTeamCheckout,
  getCloudBillingPlan,
  getLlmBalance,
  getOrgLimits,
  getOrgUsageByUser,
  getOrgUserUsageTimeseries,
  getUsageSummary,
  getUsageTimeseries,
  putOrgLimits,
  updateOverageSettings,
  type BillingCheckoutReturnOptions,
  type BillingPlanInfo,
  type BillingUrlResponse,
  type BudgetLimitInput,
  type BudgetLimitsResponse,
  type CloudOwnerSelection,
  type CurrentTeamCheckoutResponse,
  type LlmBalance,
  type OrgUsageByUserResponse,
  type OrgUserUsageTimeseriesResponse,
  type OverageSettingsResponse,
  type TeamCheckoutRequest,
  type TeamCheckoutResponse,
  type UsageSummary,
  type UsageTimeseries,
  type UsageTimeseriesQuery,
} from "@proliferate/cloud-sdk";
import { useCloudClient } from "../context/CloudClientProvider.js";
import {
  cloudBillingKey,
  currentTeamCheckoutKey,
  currentTeamKey,
  llmBalanceKey,
  orgLimitsKey,
  orgUsageByUserKey,
  orgUsageByUserRootKey,
  orgUserUsageTimeseriesKey,
  personalCloudOwnerKey,
  organizationsListKey,
  usageSummaryKey,
  usageTimeseriesKey,
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

export function useCloudBillingActions(
  owner?: CloudOwnerSelection,
  returnOptions?: BillingCheckoutReturnOptions,
) {
  const client = useCloudClient();
  const queryClient = useQueryClient();
  const keyOwner = normalizedOwner(owner);
  const invalidateBilling = async () => {
    await queryClient.invalidateQueries({ queryKey: cloudBillingKey(keyOwner) });
  };

  const cloudCheckout = useMutation<BillingUrlResponse>({
    mutationFn: () => createCloudCheckoutSession(keyOwner, client, returnOptions),
    onSuccess: invalidateBilling,
  });
  const billingPortal = useMutation<BillingUrlResponse>({
    mutationFn: () => createBillingPortalSession(keyOwner, client, returnOptions),
    onSuccess: invalidateBilling,
  });
  const refillCheckout = useMutation<BillingUrlResponse>({
    mutationFn: () => createRefillCheckoutSession(keyOwner, client, returnOptions),
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

export function useCurrentTeamCheckout(enabled = true) {
  const client = useCloudClient();
  return useQuery<CurrentTeamCheckoutResponse>({
    queryKey: currentTeamCheckoutKey(),
    queryFn: () => getCurrentTeamCheckout(client),
    enabled,
  });
}

export function useTeamCheckoutActions() {
  const client = useCloudClient();
  const queryClient = useQueryClient();
  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: currentTeamCheckoutKey() }),
      queryClient.invalidateQueries({ queryKey: organizationsListKey() }),
      queryClient.invalidateQueries({ queryKey: currentTeamKey() }),
    ]);
  };

  const create = useMutation<TeamCheckoutResponse, Error, TeamCheckoutRequest>({
    mutationFn: (input) => createTeamCheckoutSession(input, client),
    onSuccess: invalidate,
  });
  const cancel = useMutation<CurrentTeamCheckoutResponse, Error, string>({
    mutationFn: (intentId) => cancelTeamCheckout(intentId, client),
    onSuccess: invalidate,
  });

  return {
    createTeamCheckout: create.mutateAsync,
    creatingTeamCheckout: create.isPending,
    cancelTeamCheckout: cancel.mutateAsync,
    cancelingTeamCheckout: cancel.isPending,
  };
}

export function useUsageSummary(owner?: CloudOwnerSelection, enabled = true) {
  const client = useCloudClient();
  const keyOwner = normalizedOwner(owner);
  return useQuery<UsageSummary>({
    queryKey: usageSummaryKey(keyOwner),
    queryFn: () => getUsageSummary(keyOwner, client),
    enabled,
  });
}

export function useUsageTimeseries(
  query?: UsageTimeseriesQuery,
  owner?: CloudOwnerSelection,
  enabled = true,
) {
  const client = useCloudClient();
  const keyOwner = normalizedOwner(owner);
  return useQuery<UsageTimeseries>({
    queryKey: usageTimeseriesKey(keyOwner, query ?? {}),
    queryFn: () => getUsageTimeseries(query, keyOwner, client),
    enabled,
  });
}

export function useLlmBalance(owner?: CloudOwnerSelection, enabled = true) {
  const client = useCloudClient();
  const keyOwner = normalizedOwner(owner);
  return useQuery<LlmBalance>({
    queryKey: llmBalanceKey(keyOwner),
    queryFn: () => getLlmBalance(keyOwner, client),
    enabled,
  });
}

export function useOrgUsageByUser(
  organizationId: string | null,
  days?: number,
  enabled = true,
) {
  const client = useCloudClient();
  return useQuery<OrgUsageByUserResponse>({
    queryKey: orgUsageByUserKey(organizationId, days ?? null),
    queryFn: () => getOrgUsageByUser(organizationId!, days, client),
    enabled: enabled && !!organizationId,
  });
}

export function useOrgUserUsageTimeseries(
  organizationId: string | null,
  userId: string | null,
  query?: UsageTimeseriesQuery,
  enabled = true,
) {
  const client = useCloudClient();
  return useQuery<OrgUserUsageTimeseriesResponse>({
    queryKey: orgUserUsageTimeseriesKey(organizationId, userId, query ?? {}),
    queryFn: () => getOrgUserUsageTimeseries(organizationId!, userId!, query, client),
    enabled: enabled && !!organizationId && !!userId,
  });
}

export function useOrgLimits(organizationId: string | null, enabled = true) {
  const client = useCloudClient();
  return useQuery<BudgetLimitsResponse>({
    queryKey: orgLimitsKey(organizationId),
    queryFn: () => getOrgLimits(organizationId!, client),
    enabled: enabled && !!organizationId,
  });
}

export function useUpdateOrgLimits(organizationId: string | null) {
  const client = useCloudClient();
  const queryClient = useQueryClient();

  return useMutation<BudgetLimitsResponse, Error, BudgetLimitInput[]>({
    mutationFn: (limits) => putOrgLimits(organizationId!, limits, client),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: orgLimitsKey(organizationId) }),
        queryClient.invalidateQueries({ queryKey: orgUsageByUserRootKey(organizationId) }),
        queryClient.invalidateQueries({
          queryKey: usageSummaryKey({ ownerScope: "organization", organizationId }),
        }),
      ]);
    },
  });
}
