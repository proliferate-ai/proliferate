import type { BillingReturnSurface } from "@proliferate/cloud-sdk";
import { BillingSettingsPane } from "@proliferate/product-ui/billing/BillingSettingsPane";
import {
  BillingBalanceNotice,
  billingGateView,
  toBillingGateReason,
} from "@proliferate/product-ui/patterns/BillingGateState";
import { SettingsPageHeader } from "@proliferate/product-ui/patterns/SettingsPageHeader";
import {
  BillingAutoTopUpCard,
  BillingPlanCard,
  BillingPortalCard,
} from "#product/components/settings/panes/billing/BillingManagementCards";
import { BillingUsageUnitsSection } from "#product/components/settings/panes/billing/BillingUsageUnitsSection";
import { useBillingSettingsWorkflow } from "#product/hooks/settings/workflows/use-billing-settings-workflow";
import {
  billingUnitBalances,
  planKeyForBilling,
  planSummary,
  type BillingCheckoutReturnState,
  type BillingSettingsOrganization,
} from "#product/lib/domain/settings/billing-settings-presentation";

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
  const workflow = useBillingSettingsWorkflow({
    organization,
    enabled,
    billingReturnSurface,
    checkoutReturnState,
    onOpenUrl,
    onOpenPricingPage,
    onOpenOrganizationSettings,
  });
  const billingPlan = workflow.billingPlan;
  const currentPlanKey = planKeyForBilling(billingPlan);
  const plan = billingPlan ? planSummary(currentPlanKey, billingPlan) : null;
  const billingLoading = enabled && workflow.billingPlanLoading && !billingPlan;
  const billingErrorMessage = enabled && workflow.billingPlanError
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
    planError: workflow.billingPlanError,
    onRetryPlan: workflow.retryBillingPlan,
    llmBalance: workflow.llmBalance,
    llmBalanceLoading: enabled && workflow.llmBalanceLoading && !workflow.llmBalance,
    llmBalanceError: workflow.llmBalanceError,
    onRetryLlmBalance: workflow.retryLlmBalance,
    enabled,
  });
  const topUpEnabled = Boolean(
    billingPlan?.managedCloudOverageEnabled || billingPlan?.overageEnabled,
  );
  const canManage = organization?.canManageBilling === true;
  const paidPlan = billingPlan?.isPaidCloud === true;
  const comparisonActionDisabled = !enabled
    || organizationLoading
    || workflow.billingPlanLoading
    || workflow.billingPlanError
    || !billingPlan;
  const billingActionDisabled = comparisonActionDisabled || !canManage || !paidPlan;
  const coreActionLoading = billingPlan?.isPaidCloud
    ? workflow.creatingBillingPortal
    : workflow.creatingCloudCheckout;
  // T2: a paused plan explains itself — reason + repair action, not just a
  // "Paused" badge. Repairs stay on this page, so no "Billing settings" CTA.
  const startBlockedGate = billingPlan?.startBlocked && billingPlan.billingMode === "enforce"
    ? billingGateView(toBillingGateReason(billingPlan.startBlockReason), {
        isPaidPlan: paidPlan,
        canManageBilling: organization ? canManage : true,
        onUpgrade: () => {
          void workflow.openComparisonBillingAction("checkout");
        },
        onRefill: () => {
          void workflow.openComparisonBillingAction("refill");
        },
        actionLoading: workflow.creatingCloudCheckout || workflow.creatingRefillCheckout,
        actionDisabled: comparisonActionDisabled,
      })
    : null;

  return (
    <section className="space-y-6">
      <SettingsPageHeader
        title="Billing"
        description="Manage usage and billing details."
      />
      {startBlockedGate ? (
        <BillingBalanceNotice
          view={startBlockedGate}
          errorMessage={workflow.comparisonActionError}
        />
      ) : null}
      <BillingSettingsPane
        checkoutReturnState={checkoutReturnState}
        currentPlanKey={currentPlanKey}
        planComparisonAction={{
          label: !organization ? "Create organization" : "Manage plan",
          disabled: comparisonActionDisabled,
          onClick: workflow.openPlanManagement,
        }}
        enterprisePlanAction={onOpenPricingPage ? {
          label: "Request trial",
          onClick: workflow.openPricingPage,
        } : undefined}
        planManagementDialog={canManage && organization ? {
          open: workflow.planManagementOpen,
          onClose: workflow.closePlanManagement,
          currentPlanKey,
          organizationName: organization.name,
          coreAction: {
            label: billingPlan?.isPaidCloud ? "Manage Core" : "Upgrade to Core",
            loading: coreActionLoading,
            disabled: comparisonActionDisabled,
            onClick: () => {
              void workflow.openComparisonBillingAction(
                billingPlan?.isPaidCloud ? "portal" : "checkout",
              );
            },
          },
          portalAction: billingPlan?.isPaidCloud
            ? {
                label: "Billing portal",
                loading: workflow.creatingBillingPortal,
                disabled: comparisonActionDisabled,
                onClick: () => {
                  void workflow.openComparisonBillingAction("portal");
                },
              }
            : undefined,
          enterpriseAction: onOpenPricingPage ? {
            label: "Request trial",
            onClick: workflow.openPricingPage,
          } : undefined,
          pricingAction: onOpenPricingPage ? {
            label: "Learn more about pricing",
            onClick: workflow.openPricingPage,
          } : undefined,
          actionErrorMessage: workflow.comparisonActionError,
        } : undefined}
      >
        <BillingPlanCard
          plan={plan}
          organization={organization}
          organizationLoading={organizationLoading}
          loading={billingLoading}
          errorMessage={billingErrorMessage}
          unavailableMessage={billingUnavailableMessage}
          actionError={workflow.comparisonActionError}
          onRetry={workflow.retryBillingPlan}
          onManage={workflow.openPlanManagement}
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
              disabled={billingActionDisabled || workflow.updatingOverage}
              saving={workflow.updatingOverage}
              onEnabledChange={(value) => {
                void workflow.updateComparisonTopUp(value);
              }}
            />

            <BillingPortalCard
              loading={workflow.creatingBillingPortal}
              disabled={billingActionDisabled}
              onOpenPortal={() => {
                void workflow.openComparisonBillingAction("portal");
              }}
            />
          </>
        ) : null}
      </BillingSettingsPane>
    </section>
  );
}
