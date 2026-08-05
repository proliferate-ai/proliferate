import { useCallback, useEffect, useState } from "react";
import type { BillingReturnSurface, CloudOwnerSelection } from "@proliferate/cloud-sdk";
import { useBillingPlanAccess } from "#product/hooks/access/cloud/billing/use-billing-plan";
import { useLlmBalanceAccess } from "#product/hooks/access/cloud/billing/use-llm-balance";
import type {
  BillingCheckoutReturnState,
  BillingSettingsOrganization,
} from "#product/lib/domain/settings/billing-settings-presentation";

interface BillingSettingsWorkflowOptions {
  organization: BillingSettingsOrganization | null;
  enabled: boolean;
  billingReturnSurface: BillingReturnSurface;
  checkoutReturnState: BillingCheckoutReturnState;
  onOpenUrl: (url: string) => void | Promise<void>;
  onOpenPricingPage?: () => void | Promise<void>;
  onOpenOrganizationSettings: () => void;
}

export function useBillingSettingsWorkflow({
  organization,
  enabled,
  billingReturnSurface,
  checkoutReturnState,
  onOpenUrl,
  onOpenPricingPage,
  onOpenOrganizationSettings,
}: BillingSettingsWorkflowOptions) {
  const comparisonOwner: CloudOwnerSelection | undefined = organization
    ? { ownerScope: "organization", organizationId: organization.id }
    : undefined;
  const { billingQuery, billingActions } = useBillingPlanAccess({
    owner: comparisonOwner,
    enabled,
    returnSurface: billingReturnSurface,
  });
  const llmBalanceQuery = useLlmBalanceAccess(comparisonOwner, enabled);
  const [comparisonActionError, setComparisonActionError] = useState<string | null>(null);
  const [planManagementOpen, setPlanManagementOpen] = useState(false);

  useEffect(() => {
    if (checkoutReturnState !== "success") {
      return;
    }
    void billingQuery.refetch();
  }, [billingQuery.refetch, checkoutReturnState]);

  const openPlanManagement = useCallback(() => {
    setComparisonActionError(null);
    if (!organization) {
      onOpenOrganizationSettings();
      return;
    }
    if (!organization.canManageBilling) {
      setComparisonActionError("Organization billing is managed by owners and admins.");
      return;
    }
    setPlanManagementOpen(true);
  }, [onOpenOrganizationSettings, organization]);

  const openComparisonBillingAction = useCallback(async (
    action: "checkout" | "portal" | "refill",
  ) => {
    setComparisonActionError(null);
    try {
      const response = action === "portal"
        ? await billingActions.createBillingPortal()
        : action === "refill"
          ? await billingActions.createRefillCheckout()
          : await billingActions.createCloudCheckout();
      await onOpenUrl(response.url);
    } catch (error) {
      setComparisonActionError(
        error instanceof Error ? error.message : "Billing action could not start.",
      );
    }
  }, [
    billingActions.createBillingPortal,
    billingActions.createCloudCheckout,
    billingActions.createRefillCheckout,
    onOpenUrl,
  ]);

  const updateComparisonTopUp = useCallback(async (nextEnabled: boolean) => {
    setComparisonActionError(null);
    try {
      await billingActions.updateOverageEnabled({ enabled: nextEnabled });
    } catch (error) {
      setComparisonActionError(
        error instanceof Error ? error.message : "Top up setting could not be updated.",
      );
    }
  }, [billingActions.updateOverageEnabled]);

  const openPricingPage = useCallback(() => {
    if (!onOpenPricingPage) {
      return;
    }
    void onOpenPricingPage();
  }, [onOpenPricingPage]);
  const closePlanManagement = useCallback(() => {
    setPlanManagementOpen(false);
  }, []);
  const retryBillingPlan = useCallback(() => {
    void billingQuery.refetch();
  }, [billingQuery.refetch]);
  const retryLlmBalance = useCallback(() => {
    void llmBalanceQuery.refetch();
  }, [llmBalanceQuery.refetch]);

  return {
    billingPlan: billingQuery.data,
    billingPlanLoading: billingQuery.isLoading,
    billingPlanError: billingQuery.isError,
    llmBalance: llmBalanceQuery.data,
    llmBalanceLoading: llmBalanceQuery.isLoading,
    llmBalanceError: llmBalanceQuery.isError,
    creatingCloudCheckout: billingActions.creatingCloudCheckout,
    creatingBillingPortal: billingActions.creatingBillingPortal,
    creatingRefillCheckout: billingActions.creatingRefillCheckout,
    updatingOverage: billingActions.updatingOverage,
    comparisonActionError,
    planManagementOpen,
    openPlanManagement,
    closePlanManagement,
    openComparisonBillingAction,
    updateComparisonTopUp,
    openPricingPage,
    retryBillingPlan,
    retryLlmBalance,
  };
}
