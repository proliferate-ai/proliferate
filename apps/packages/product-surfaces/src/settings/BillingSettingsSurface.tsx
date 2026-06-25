import { useEffect, useState } from "react";
import type { BillingReturnSurface } from "@proliferate/cloud-sdk";
import {
  useCloudBilling,
  useCloudBillingActions,
} from "@proliferate/cloud-sdk-react";
import {
  BillingSettingsPane,
  type BillingPlanView,
} from "@proliferate/product-ui/billing/BillingSettingsPane";
import { SettingsPageHeader } from "@proliferate/product-ui/settings/SettingsPageHeader";
import {
  BillingAutoTopUpCard,
  BillingPlanCard,
  BillingPortalCard,
  type BillingPlanPresentation,
} from "./BillingManagementCards";
import {
  BillingUsageUnitsSection,
  type BillingUnitBalancePresentation,
} from "./BillingUsageUnitsSection";

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

const MOCK_COMPUTE_BALANCE: BillingUnitBalancePresentation = {
  kind: "compute",
  title: "Compute units",
  description: "Used by hosted runtime, sandboxes, and execution time.",
  purchased: "360 PCUs",
  available: "118 PCUs",
  used: "242 PCUs",
  availablePercent: 33,
  topUpLabel: "Add compute units",
  lowBalanceCopy: "Need more runtime capacity? Add compute units any time.",
};

const MOCK_LLM_BALANCE: BillingUnitBalancePresentation = {
  kind: "llm",
  title: "LLM credits",
  description: "Used by model gateway calls, inference-backed tools, and managed model access.",
  purchased: "12,000 LLM credits",
  available: "4,600 LLM credits",
  used: "7,400 LLM credits",
  availablePercent: 38,
  topUpLabel: "Add LLM credits",
  lowBalanceCopy: "Need more model usage? Add LLM credits any time.",
};

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
  const comparisonOwner = organization?.canManageBilling
    ? { ownerScope: "organization" as const, organizationId: organization.id }
    : undefined;
  const comparisonBilling = useCloudBilling(comparisonOwner, enabled);
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
  const plan = planSummary(currentPlanKey, billingPlan);
  const unitBalances = billingUnitBalances(billingPlan);
  const topUpEnabled = Boolean(
    billingPlan?.managedCloudOverageEnabled || billingPlan?.overageEnabled,
  );
  const canManage = organization?.canManageBilling === true;
  const paidPlan = billingPlan?.isPaidCloud === true;
  const comparisonActionDisabled = !enabled
    || organizationLoading
    || (canManage ? comparisonBilling.isLoading : false);
  const billingActionDisabled = comparisonActionDisabled || !canManage || !paidPlan;
  const coreActionLoading = billingPlan?.isPaidCloud
    ? comparisonActions.creatingBillingPortal
    : comparisonActions.creatingCloudCheckout;

  return (
    <section className="max-w-[820px] space-y-6">
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
          label: "View pricing",
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
            label: "View pricing",
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
          loading={canManage ? comparisonBilling.isLoading : false}
          actionError={comparisonActionError}
          onManage={openPlanManagement}
        />

        <BillingUsageUnitsSection
          unitBalances={unitBalances}
          addCreditsLoading={false}
          addCreditsDisabled
        />

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
      </BillingSettingsPane>
    </section>
  );
}

type BillingPlanViewKey = "free" | "core" | "enterprise";

function planKeyForBilling(plan: BillingPlanView | null | undefined): BillingPlanViewKey | null {
  if (!plan) {
    return null;
  }
  if (plan.isUnlimited && !plan.isPaidCloud) {
    return "enterprise";
  }
  return plan.isPaidCloud ? "core" : "free";
}

function planSummary(
  planKey: BillingPlanViewKey | null,
  plan: BillingPlanView | null | undefined,
): BillingPlanPresentation {
  if (!plan) {
    return {
      name: "Core plan",
      price: "$20/month",
      badge: "Mocked",
      badgeTone: "neutral",
    };
  }
  if (planKey === "enterprise") {
    return {
      name: "Enterprise plan",
      price: "custom",
      badge: "Active",
      badgeTone: "success",
    };
  }
  if (planKey === "core") {
    return {
      name: "Core plan",
      price: "$20/month",
      badge: "Active",
      badgeTone: "success",
    };
  }
  return {
    name: "Free plan",
    price: "$0/month",
    badge: "Active",
    badgeTone: "neutral",
  };
}

function billingUnitBalances(
  plan: BillingPlanView | null | undefined,
): BillingUnitBalancePresentation[] {
  return [
    computeBalanceSummary(plan),
    MOCK_LLM_BALANCE,
  ];
}

function computeBalanceSummary(
  plan: BillingPlanView | null | undefined,
): BillingUnitBalancePresentation {
  if (!plan) {
    return MOCK_COMPUTE_BALANCE;
  }

  const visibleGrants = (plan.grantAllocations ?? []).filter((grant) =>
    grant.active || grant.consumedSeconds > 0 || grant.remainingSeconds > 0
  );
  if (visibleGrants.length > 0) {
    const purchased = visibleGrants.reduce(
      (total, grant) => total + secondsToCredits(grant.totalSeconds),
      0,
    );
    const available = visibleGrants.reduce(
      (total, grant) => total + secondsToCredits(grant.remainingSeconds),
      0,
    );
    const used = visibleGrants.reduce(
      (total, grant) => total + secondsToCredits(grant.consumedSeconds),
      0,
    );
    return {
      ...MOCK_COMPUTE_BALANCE,
      purchased: formatCredits(purchased),
      available: formatCredits(available),
      used: formatCredits(used),
      availablePercent: purchased > 0 ? Math.round((available / purchased) * 100) : null,
    };
  }

  return MOCK_COMPUTE_BALANCE;
}

function secondsToCredits(seconds: number | null | undefined): number {
  return Math.max(seconds ?? 0, 0) / 3600;
}

function formatCredits(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "Unlimited";
  }
  const rounded = Math.round(Math.max(value, 0) * 10) / 10;
  const formatted = rounded.toLocaleString(undefined, {
    maximumFractionDigits: Number.isInteger(rounded) ? 0 : 1,
  });
  return `${formatted} ${rounded === 1 ? "PCU" : "PCUs"}`;
}
