import { useState } from "react";
import { useSearchParams } from "react-router-dom";

import type { CloudOwnerSelection } from "@proliferate/cloud-sdk";
import {
  BillingOwnerCard,
  BillingSettingsPane,
  type BillingActionView,
  type BillingOwnerCardView,
  type BillingPlanView,
} from "@proliferate/product-ui/billing/BillingSettingsPane";
import { SettingsCard } from "@proliferate/product-ui/settings/SettingsCard";
import { SettingsCardRow } from "@proliferate/product-ui/settings/SettingsCardRow";
import { SettingsPageHeader } from "@proliferate/product-ui/settings/SettingsPageHeader";
import {
  useCloudBilling,
  useCloudBillingActions,
  useOrganizations,
} from "@proliferate/cloud-sdk-react";

export function BillingSettingsSection() {
  const organizations = useOrganizations();
  const [searchParams] = useSearchParams();
  const adminOrganizations = (organizations.data?.organizations ?? []).filter((organization) => {
    const role = organization.membership?.role;
    return organization.membership?.status === "active" && (role === "owner" || role === "admin");
  });
  const comparisonOwner = adminOrganizations[0]
    ? { ownerScope: "organization" as const, organizationId: adminOrganizations[0].id }
    : undefined;
  const comparisonBilling = useCloudBilling(comparisonOwner);
  const comparisonActions = useCloudBillingActions(comparisonOwner);
  const [comparisonActionError, setComparisonActionError] = useState<string | null>(null);
  const checkoutReturnState = checkoutReturnStateFromParams(searchParams);

  async function openComparisonBillingAction() {
    setComparisonActionError(null);
    try {
      const response = comparisonBilling.data?.isPaidCloud
        ? await comparisonActions.createBillingPortal()
        : await comparisonActions.createCloudCheckout();
      window.location.assign(response.url);
    } catch (error) {
      setComparisonActionError(error instanceof Error ? error.message : "Billing action could not start.");
    }
  }

  return (
    <section className="space-y-6">
      <SettingsPageHeader
        title="Billing"
        description="Manage personal and organization cloud usage, included runtime, overage, and plan changes."
      />
      <BillingSettingsPane
        checkoutReturnState={checkoutReturnState}
        currentPlanKey={planKeyForBilling(comparisonBilling.data)}
        planComparisonAction={{
          label: comparisonBilling.data?.isPaidCloud ? "Manage Team billing" : "Upgrade to Team",
          loading: comparisonBilling.data?.isPaidCloud
            ? comparisonActions.creatingBillingPortal
            : comparisonActions.creatingCloudCheckout,
          disabled: organizations.isLoading || comparisonBilling.isLoading,
          onClick: () => {
            void openComparisonBillingAction();
          },
        }}
      >
        {comparisonActionError ? (
          <SettingsCard>
            <SettingsCardRow label="Plan action failed" description={comparisonActionError} />
          </SettingsCard>
        ) : null}

        <BillingOwnerController
          title="Personal billing"
          description="Applies to your personal cloud sandbox, local-to-cloud work, and personal dispatch usage."
          iconKind="personal"
        />

        {organizations.isLoading ? (
          <SettingsCard>
            <SettingsCardRow label="Organization billing" description="Loading organizations..." />
          </SettingsCard>
        ) : null}

        {adminOrganizations.map((organization) => (
          <BillingOwnerController
            key={organization.id}
            title={`${organization.name} billing`}
            description="Applies to shared cloud workspaces, team automations, Slack sessions, and shared sandbox usage."
            iconKind="organization"
            owner={{ ownerScope: "organization", organizationId: organization.id }}
          />
        ))}
      </BillingSettingsPane>
    </section>
  );
}

function BillingOwnerController({
  title,
  description,
  iconKind,
  owner,
}: {
  title: string;
  description: string;
  iconKind: "personal" | "organization";
  owner?: CloudOwnerSelection;
}) {
  const billing = useCloudBilling(owner);
  const billingActions = useCloudBillingActions(owner);
  const billingPlan = billing.data;
  const [actionError, setActionError] = useState<string | null>(null);
  const invoiceUrl = billingPlan?.hostedInvoiceUrl ?? null;

  async function openBillingAction(action: "checkout" | "portal" | "refill") {
    setActionError(null);
    try {
      const response = action === "portal"
        ? await billingActions.createBillingPortal()
        : action === "refill"
          ? await billingActions.createRefillCheckout()
          : await billingActions.createCloudCheckout();
      window.location.assign(response.url);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Billing action could not start.");
    }
  }

  async function updateOverage(enabled: boolean) {
    setActionError(null);
    try {
      await billingActions.updateOverageEnabled({ enabled });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Overage settings could not be updated.");
    }
  }

  const view: BillingOwnerCardView = {
    title,
    description,
    iconKind,
    plan: billingPlan,
    loading: billing.isLoading,
    error: billing.isError ? "Billing details could not be loaded." : null,
    actionError,
    retryAction: billing.isError
      ? {
          label: "Retry",
          onClick: () => {
            void billing.refetch();
          },
        }
      : undefined,
    manageAction: {
      label: "Manage billing",
      loading: billingActions.creatingBillingPortal,
      onClick: () => {
        void openBillingAction("portal");
      },
    },
    upgradeAction: {
      label: iconKind === "organization" ? "Upgrade organization" : "Upgrade account",
      loading: billingActions.creatingCloudCheckout,
      onClick: () => {
        void openBillingAction("checkout");
      },
    },
    refillAction: billingPlan?.isPaidCloud && !billingPlan.proBillingEnabled && !billingPlan.hasUnlimitedCloudHours
      ? {
          label: "Refill 10h",
          loading: billingActions.creatingRefillCheckout,
          onClick: () => {
            void openBillingAction("refill");
          },
        }
      : undefined,
    overageAction: overageActionForPlan({
      plan: billingPlan,
      loading: billingActions.updatingOverage,
      onUpdate: updateOverage,
    }),
    invoiceAction: invoiceUrl
      ? {
          label: "View invoice",
          onClick: () => {
            window.location.assign(invoiceUrl);
          },
        }
      : undefined,
  };

  return <BillingOwnerCard view={view} />;
}

function planKeyForBilling(plan: BillingPlanView | null | undefined) {
  if (!plan) {
    return null;
  }
  if (plan.isUnlimited && !plan.isPaidCloud) {
    return "enterprise";
  }
  return plan.isPaidCloud ? "team" : "free";
}

function checkoutReturnStateFromParams(
  searchParams: URLSearchParams,
): "success" | "cancel" | null {
  const checkout = searchParams.get("checkout");
  return checkout === "success" || checkout === "cancel" ? checkout : null;
}

function overageActionForPlan({
  plan,
  loading,
  onUpdate,
}: {
  plan: ReturnType<typeof useCloudBilling>["data"];
  loading: boolean;
  onUpdate: (enabled: boolean) => Promise<void>;
}): BillingActionView | undefined {
  if (!plan?.isPaidCloud || plan.isUnlimited) {
    return undefined;
  }

  if (plan.proBillingEnabled && plan.legacyCloudSubscription) {
    return undefined;
  }

  if (plan.proBillingEnabled) {
    const nextEnabled = !plan.managedCloudOverageEnabled;
    return {
      label: nextEnabled ? "Turn on overage" : "Turn off overage",
      loading,
      onClick: () => {
        void onUpdate(nextEnabled);
      },
    };
  }

  if (plan.hasUnlimitedCloudHours) {
    return undefined;
  }

  const nextEnabled = !plan.overageEnabled;
  return {
    label: nextEnabled ? "Turn on overage" : "Turn off overage",
    loading,
    onClick: () => {
      void onUpdate(nextEnabled);
    },
  };
}
