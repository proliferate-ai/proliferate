import { useCallback } from "react";
import type { BillingUrlResponse } from "@/lib/access/cloud/client";
import type { CloudOwnerSelection } from "@/lib/domain/cloud/billing";
import {
  useAccountCredits as useSdkAccountCredits,
  useAccountCreditsActions as useSdkAccountCreditsActions,
  useTeamBilling as useSdkTeamBilling,
  useTeamBillingActions as useSdkTeamBillingActions,
  useTeamBillingEvents as useSdkTeamBillingEvents,
} from "@proliferate/cloud-sdk-react";
import type { TeamCheckoutRequest, TeamOverageSettingsInput } from "@proliferate/cloud-sdk";
import {
  useCloudBillingMutations,
  useCloudBillingQuery,
  useInvalidateCloudBillingState,
} from "@/hooks/access/cloud/use-cloud-billing";
import { useTauriShellActions } from "@/hooks/access/tauri/use-shell-actions";
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

export function useAccountCredits(options?: { enabled?: boolean }) {
  const { billingEnabled } = useAppCapabilities();
  const { cloudActive } = useCloudAvailabilityState();
  return useSdkAccountCredits(billingEnabled && cloudActive && (options?.enabled ?? true));
}

export function useAccountCreditsActions() {
  return useSdkAccountCreditsActions();
}

export function useTeamBilling(options?: { enabled?: boolean }) {
  const { billingEnabled } = useAppCapabilities();
  const authStatus = useAuthStore((state) => state.status);
  return useSdkTeamBilling(
    billingEnabled && authStatus === "authenticated" && (options?.enabled ?? true),
  );
}

export function useTeamBillingEvents(options?: { enabled?: boolean }) {
  const { billingEnabled } = useAppCapabilities();
  const authStatus = useAuthStore((state) => state.status);
  return useSdkTeamBillingEvents(
    billingEnabled && authStatus === "authenticated" && (options?.enabled ?? true),
  );
}

export function useTeamBillingActions() {
  const { openExternal } = useTauriShellActions();
  const teamBillingActions = useSdkTeamBillingActions();

  const openBillingUrl = useCallback(async (response: BillingUrlResponse) => {
    await openExternal(response.url);
    return response;
  }, [openExternal]);

  const createTeamCheckout = useCallback(async (input: TeamCheckoutRequest) => {
    const response = await teamBillingActions.createTeamCheckout(input);
    await openBillingUrl(response);
    return response;
  }, [openBillingUrl, teamBillingActions.createTeamCheckout]);

  const createTeamBillingPortal = useCallback(async () => {
    const response = await teamBillingActions.createTeamBillingPortal();
    await openBillingUrl(response);
    return response;
  }, [openBillingUrl, teamBillingActions.createTeamBillingPortal]);

  const updateTeamOverageSettings = useCallback(async (
    input: TeamOverageSettingsInput,
  ) => teamBillingActions.updateTeamOverageSettings(input), [
    teamBillingActions.updateTeamOverageSettings,
  ]);

  return {
    createTeamCheckout,
    creatingTeamCheckout: teamBillingActions.creatingTeamCheckout,
    createTeamBillingPortal,
    creatingTeamBillingPortal: teamBillingActions.creatingTeamBillingPortal,
    updateTeamOverageSettings,
    updatingTeamOverageSettings: teamBillingActions.updatingTeamOverageSettings,
  };
}

export function useCloudBillingActions(owner?: CloudOwnerSelection) {
  const { openExternal } = useTauriShellActions();
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
    updateOverageEnabled,
    creatingCloudCheckout: billingMutations.creatingCloudCheckout,
    creatingBillingPortal: billingMutations.creatingBillingPortal,
    updatingOverage: billingMutations.updatingOverage,
  };
}
