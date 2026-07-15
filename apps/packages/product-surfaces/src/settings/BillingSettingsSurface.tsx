import { useEffect, useState } from "react";
import type { BillingReturnSurface } from "@proliferate/cloud-sdk";
import {
  useCloudBilling,
  useCloudBillingActions,
  useLlmBalance,
} from "@proliferate/cloud-sdk-react";
import { BillingSettingsPane } from "@proliferate/product-ui/billing/BillingSettingsPane";
import { SettingsPageHeader } from "@proliferate/product-ui/settings/SettingsPageHeader";
import {
  BillingAutoTopUpCard,
  BillingPlanCard,
  BillingPortalCard,
} from "./BillingManagementCards";
import { BillingUsageUnitsSection } from "./BillingUsageUnitsSection";
import {
  billingUnitBalances,
  planKeyForBilling,
  planSummary,
} from "./billing-settings-presentation";

export type BillingCheckoutReturnState = "success" | "cancel" | null;

export interface BillingSettingsOrganization {
  id: string;
  name: string;
  canManageBilling: boolean;
  loading: boolean;
}

export interface BillingSettingsSurfaceProps {
  organization: BillingSettingsOrganization | null;
  organizationLoading?: boolean;
  enabled?: boolean;
  billingReturnSurface?: BillingReturnSurface;
  checkoutReturnState?: BillingCheckoutReturnState;
  onOpenUrl: (url: string) => void | Promise<void>;
  onOpenPricingPage?: () => void | Promise<void>;
  onOpenOrganizationSettings: () => void;
}

export function BillingSettingsSurface({
  organization,
  organizationLoading = organization?.loading ?? false,
  enabled = true,
  billingReturnSurface = "web",
  checkoutReturnState = null,
  onOpenUrl,
  onOpenPricingPage,
  onOpenOrganizationSettings,
}: BillingSettingsSurfaceProps) {
  const billingReturnOptions = { returnSurface: billingReturnSurface };
  const comparisonOwner = organization
    ? { ownerScope: "organization" as const, organizationId: organization.id }
    : undefined;
  const comparisonBilling = useCloudBilling(comparisonOwner, enabled);
  const llmBalance = useLlmBalance(comparisonOwner, enabled);
  const comparisonActions = useCloudBillingActions(comparisonOwner, billingReturnOptions);
  const [comparisonActionError, setComparisonActionError] = useState<string | null>(null);
  const [planManagementOpen, setPlanManagementOpen] = useState(false);

  useEffect(() => {
    if (checkoutReturnState !== "success") {
      return;
    }
    void comparisonBilling.refetch();
  }, [checkoutReturnState, comparisonBilling.refetch]);

  function openPlanManagement() {
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
  }

  async function openComparisonBillingAction(action: "checkout" | "portal") {
    setComparisonActionError(null);
    try {
      const response = action === "portal"
        ? await comparisonActions.createBillingPortal()
        : await comparisonActions.createCloudCheckout();
      await onOpenUrl(response.url);
    } catch (error) {
      setComparisonActionError(
        error instanceof Error ? error.message : "Billing action could not start.",
      );
    }
  }

  async function updateComparisonTopUp(nextEnabled: boolean) {
    setComparisonActionError(null);
    try {
      await comparisonActions.updateOverageEnabled({ enabled: nextEnabled });
    } catch (error) {
      setComparisonActionError(
        error instanceof Error ? error.message : "Top up setting could not be updated.",
      );
    }
  }

  function openPricingPage() {
    if (!onOpenPricingPage) {
      return;
    }
    void onOpenPricingPage();
  }

  const billingPlan = comparisonBilling.data;
  const currentPlanKey = planKeyForBilling(billingPlan);
  const plan = billingPlan ? planSummary(currentPlanKey, billingPlan) : null;
  const billingLoading = enabled && comparisonBilling.isLoading && !billingPlan;
  const billingErrorMessage = enabled && comparisonBilling.isError
    ? "Could not load the billing plan. Retry to refresh it from Proliferate Cloud."
    : null;
  const billingUnavailableMessage = !enabled
    ? "Billing is unavailable for this deployment."
    : !billingLoading && !billingErrorMessage && !billingPlan
      ? "No billing plan was returned for this account."
      : null;
  const unitBalances = billingUnitBalances({
    plan: billingPlan,
    planLoading: billingLoading,
    planError: comparisonBilling.isError,
    onRetryPlan: () => {
      void comparisonBilling.refetch();
    },
    llmBalance: llmBalance.data,
    llmBalanceLoading: enabled && llmBalance.isLoading && !llmBalance.data,
    llmBalanceError: llmBalance.isError,
    onRetryLlmBalance: () => {
      void llmBalance.refetch();
    },
    enabled,
  });
  const topUpEnabled = Boolean(
    billingPlan?.managedCloudOverageEnabled || billingPlan?.overageEnabled,
  );
  const canManage = organization?.canManageBilling === true;
  const paidPlan = billingPlan?.isPaidCloud === true;
  const comparisonActionDisabled = !enabled
    || organizationLoading
    || comparisonBilling.isLoading
    || comparisonBilling.isError
    || !billingPlan;
  const billingActionDisabled = comparisonActionDisabled || !canManage || !paidPlan;
  const coreActionLoading = billingPlan?.isPaidCloud
    ? comparisonActions.creatingBillingPortal
    : comparisonActions.creatingCloudCheckout;

  return (
    <section className="space-y-6">
      <SettingsPageHeader
        title="Billing"
        description="Manage usage and billing details."
      />
      <BillingSettingsPane
        checkoutReturnState={checkoutReturnState}
        currentPlanKey={currentPlanKey}
        planComparisonAction={{
          label: !organization ? "Create organization" : "Manage plan",
          disabled: comparisonActionDisabled,
          onClick: openPlanManagement,
        }}
        enterprisePlanAction={onOpenPricingPage ? {
          label: "Request trial",
          onClick: openPricingPage,
        } : undefined}
        planManagementDialog={canManage && organization ? {
          open: planManagementOpen,
          onClose: () => {
            setPlanManagementOpen(false);
          },
          currentPlanKey,
          organizationName: organization.name,
          coreAction: {
            label: billingPlan?.isPaidCloud ? "Manage Core" : "Upgrade to Core",
            loading: coreActionLoading,
            disabled: comparisonActionDisabled,
            onClick: () => {
              void openComparisonBillingAction(
                billingPlan?.isPaidCloud ? "portal" : "checkout",
              );
            },
          },
          portalAction: billingPlan?.isPaidCloud
            ? {
                label: "Billing portal",
                loading: comparisonActions.creatingBillingPortal,
                disabled: comparisonActionDisabled,
                onClick: () => {
                  void openComparisonBillingAction("portal");
                },
              }
            : undefined,
          enterpriseAction: onOpenPricingPage ? {
            label: "Request trial",
            onClick: openPricingPage,
          } : undefined,
          pricingAction: onOpenPricingPage ? {
            label: "Learn more about pricing",
            onClick: openPricingPage,
          } : undefined,
          actionErrorMessage: comparisonActionError,
        } : undefined}
      >
        <BillingPlanCard
          plan={plan}
          organization={organization}
          organizationLoading={organizationLoading}
          loading={billingLoading}
          errorMessage={billingErrorMessage}
          unavailableMessage={billingUnavailableMessage}
          actionError={comparisonActionError}
          onRetry={() => {
            void comparisonBilling.refetch();
          }}
          onManage={openPlanManagement}
        />

        <BillingUsageUnitsSection
          unitBalances={unitBalances}
          addCreditsLoading={false}
          addCreditsDisabled
        />

        {billingPlan ? (
          <>
            <BillingAutoTopUpCard
              enabled={topUpEnabled}
              disabled={billingActionDisabled || comparisonActions.updatingOverage}
              saving={comparisonActions.updatingOverage}
              onEnabledChange={(value) => {
                void updateComparisonTopUp(value);
              }}
            />

            <BillingPortalCard
              loading={comparisonActions.creatingBillingPortal}
              disabled={billingActionDisabled}
              onOpenPortal={() => {
                void openComparisonBillingAction("portal");
              }}
            />
          </>
        ) : null}
      </BillingSettingsPane>
    </section>
  );
}
