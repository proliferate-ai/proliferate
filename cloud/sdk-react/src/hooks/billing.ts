import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createTeamBillingPortal,
  createTeamCheckout,
  cancelTeamCheckout,
  createBillingPortalSession,
  createCloudCheckoutSession,
  createRefillCheckoutSession,
  createTeamCheckoutSession,
  ensureAccountCredits,
  getAccountCredits,
  getCurrentTeamCheckout,
  getCloudBillingPlan,
  getTeamBilling,
  getTeamBillingEvents,
  updateTeamOverageSettings,
  updateOverageSettings,
  type AccountCreditsEnsureResponse,
  type AccountCreditsOverview,
  type BillingPlanInfo,
  type BillingUrlResponse,
  type CloudOwnerSelection,
  type CurrentTeamCheckoutResponse,
  type OverageSettingsResponse,
  type TeamBillingEnvelope,
  type TeamBillingEventsResponse,
  type TeamCheckoutRequest,
  type TeamCheckoutResponse,
  type TeamOverageSettingsInput,
} from "@proliferate/cloud-sdk";
import { useCloudClient } from "../context/CloudClientProvider.js";
import {
  accountCreditsKey,
  cloudBillingKey,
  currentTeamCheckoutKey,
  currentTeamKey,
  personalCloudOwnerKey,
  organizationsListKey,
  teamBillingEventsKey,
  teamBillingKey,
  type CloudOwnerSelectionKey,
} from "../lib/query-keys.js";

function normalizedOwner(owner?: CloudOwnerSelection): CloudOwnerSelectionKey {
  return {
    ...personalCloudOwnerKey(),
    ownerScope: owner?.ownerScope ?? "personal",
    organizationId: owner?.organizationId ?? null,
  };
}

export function useAccountCredits(enabled = true) {
  const client = useCloudClient();
  return useQuery<AccountCreditsOverview>({
    queryKey: accountCreditsKey(),
    queryFn: () => getAccountCredits(client),
    enabled,
  });
}

export function useAccountCreditsActions() {
  const client = useCloudClient();
  const queryClient = useQueryClient();
  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: accountCreditsKey() });
  };

  const ensure = useMutation<AccountCreditsEnsureResponse, Error, void>({
    mutationFn: () => ensureAccountCredits(client),
    onSuccess: invalidate,
  });

  return {
    ensureAccountCredits: () => ensure.mutateAsync(),
    ensuringAccountCredits: ensure.isPending,
  };
}

export function useTeamBilling(enabled = true) {
  const client = useCloudClient();
  return useQuery<TeamBillingEnvelope>({
    queryKey: teamBillingKey(),
    queryFn: () => getTeamBilling(client),
    enabled,
  });
}

export function useTeamBillingEvents(enabled = true) {
  const client = useCloudClient();
  return useQuery<TeamBillingEventsResponse>({
    queryKey: teamBillingEventsKey(),
    queryFn: () => getTeamBillingEvents(client),
    enabled,
  });
}

export function useTeamBillingActions() {
  const client = useCloudClient();
  const queryClient = useQueryClient();
  const invalidateTeamBilling = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: teamBillingKey() }),
      queryClient.invalidateQueries({ queryKey: teamBillingEventsKey() }),
      queryClient.invalidateQueries({ queryKey: currentTeamCheckoutKey() }),
      queryClient.invalidateQueries({ queryKey: organizationsListKey() }),
      queryClient.invalidateQueries({ queryKey: currentTeamKey() }),
    ]);
  };

  const checkout = useMutation<TeamCheckoutResponse, Error, TeamCheckoutRequest>({
    mutationFn: (input) => createTeamCheckout(input, client),
    onSuccess: invalidateTeamBilling,
  });
  const portal = useMutation<BillingUrlResponse, Error, void>({
    mutationFn: () => createTeamBillingPortal(client),
    onSuccess: invalidateTeamBilling,
  });
  const overage = useMutation<
    OverageSettingsResponse,
    Error,
    TeamOverageSettingsInput
  >({
    mutationFn: (input) => updateTeamOverageSettings(input, client),
    onSuccess: invalidateTeamBilling,
  });

  return {
    createTeamCheckout: checkout.mutateAsync,
    creatingTeamCheckout: checkout.isPending,
    createTeamBillingPortal: () => portal.mutateAsync(),
    creatingTeamBillingPortal: portal.isPending,
    updateTeamOverageSettings: overage.mutateAsync,
    updatingTeamOverageSettings: overage.isPending,
  };
}

/**
 * Legacy owner-scoped cloud billing cache. Product UI should prefer the
 * account credits and team billing facade hooks above.
 */
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
