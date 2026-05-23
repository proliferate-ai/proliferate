import { useCallback, useState } from "react";
import { useSearchParams } from "react-router-dom";

import {
  BillingOwnerCard,
  BillingSettingsPane,
  type BillingActionView,
  type BillingOwnerCardView,
  type BillingPlanView,
} from "@proliferate/product-ui/billing/BillingSettingsPane";

import { SettingsPageHeader } from "@/components/settings/shared/SettingsPageHeader";
import {
  useCloudBilling,
  useCloudBillingActions,
} from "@/hooks/cloud/facade/use-cloud-billing";
import { useIsAdmin } from "@/hooks/access/cloud/organizations/use-is-admin";
import { useTauriShellActions } from "@/hooks/access/tauri/use-shell-actions";
import { useActiveOrganization } from "@/hooks/organizations/facade/use-active-organization";
import type { CloudOwnerSelection } from "@/lib/domain/cloud/billing";

export function BillingPane() {
  const { activeOrganization, activeOrganizationId } = useActiveOrganization();
  const admin = useIsAdmin(activeOrganizationId);
  const [searchParams] = useSearchParams();
  const comparisonOwner = activeOrganization && admin.isAdmin
    ? { ownerScope: "organization" as const, organizationId: activeOrganization.id }
    : undefined;
  const comparisonBilling = useCloudBilling(comparisonOwner);
  const comparisonActions = useCloudBillingActions(comparisonOwner);
  const [comparisonActionError, setComparisonActionError] = useState<string | null>(null);

  async function openComparisonBillingAction() {
    setComparisonActionError(null);
    try {
      if (comparisonBilling.data?.isPaidCloud) {
        await comparisonActions.createBillingPortal();
      } else {
        await comparisonActions.createCloudCheckout();
      }
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
        checkoutReturnState={checkoutReturnStateFromParams(searchParams)}
        currentPlanKey={planKeyForBilling(comparisonBilling.data)}
        planComparisonAction={{
          label: comparisonBilling.data?.isPaidCloud ? "Manage Team billing" : "Upgrade to Team",
          loading: comparisonBilling.data?.isPaidCloud
            ? comparisonActions.creatingBillingPortal
            : comparisonActions.creatingCloudCheckout,
          disabled: comparisonBilling.isLoading || (activeOrganization ? admin.isLoading : false),
          onClick: () => {
            void openComparisonBillingAction();
          },
        }}
      >
        {comparisonActionError ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
            {comparisonActionError}
          </div>
        ) : null}

        {activeOrganization ? (
          <BillingOwnerController
            title={`${activeOrganization.name} billing`}
            description={
              admin.isAdmin
                ? "Applies to shared cloud workspaces, team automations, Slack sessions, and shared sandbox usage."
                : "Organization billing is managed by owners and admins."
            }
            iconKind="organization"
            owner={{ ownerScope: "organization", organizationId: activeOrganization.id }}
            actionsEnabled={admin.isAdmin}
          />
        ) : null}

        <BillingOwnerController
          title="Personal billing"
          description="Applies to your personal cloud sandbox, local-to-cloud work, and personal dispatch usage."
          iconKind="personal"
          actionsEnabled
        />
      </BillingSettingsPane>
    </section>
  );
}

function BillingOwnerController({
  title,
  description,
  iconKind,
  owner,
  actionsEnabled,
}: {
  title: string;
  description: string;
  iconKind: "personal" | "organization";
  owner?: CloudOwnerSelection;
  actionsEnabled: boolean;
}) {
  const billing = useCloudBilling(owner);
  const billingActions = useCloudBillingActions(owner);
  const billingPlan = billing.data;
  const [actionError, setActionError] = useState<string | null>(null);
  const invoiceUrl = billingPlan?.hostedInvoiceUrl ?? null;
  const openInvoice = useOpenExternalUrl(invoiceUrl);

  async function openBillingAction(action: "checkout" | "portal" | "refill") {
    if (!actionsEnabled) {
      return;
    }
    setActionError(null);
    try {
      if (action === "portal") {
        await billingActions.createBillingPortal();
      } else if (action === "refill") {
        await billingActions.createRefillCheckout();
      } else {
        await billingActions.createCloudCheckout();
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Billing action could not start.");
    }
  }

  async function updateOverage(enabled: boolean) {
    if (!actionsEnabled) {
      return;
    }
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
    manageAction: actionsEnabled
      ? {
          label: "Manage billing",
          loading: billingActions.creatingBillingPortal,
          onClick: () => {
            void openBillingAction("portal");
          },
        }
      : undefined,
    upgradeAction: actionsEnabled
      ? {
          label: iconKind === "organization" ? "Upgrade organization" : "Upgrade account",
          loading: billingActions.creatingCloudCheckout,
          onClick: () => {
            void openBillingAction("checkout");
          },
        }
      : undefined,
    refillAction: actionsEnabled
      && billingPlan?.isPaidCloud
      && !billingPlan.proBillingEnabled
      && !billingPlan.hasUnlimitedCloudHours
      ? {
          label: "Refill 10h",
          loading: billingActions.creatingRefillCheckout,
          onClick: () => {
            void openBillingAction("refill");
          },
        }
      : undefined,
    overageAction: actionsEnabled
      ? overageActionForPlan({
          plan: billingPlan,
          loading: billingActions.updatingOverage,
          onUpdate: updateOverage,
        })
      : undefined,
    invoiceAction: actionsEnabled && invoiceUrl
      ? {
          label: "View invoice",
          onClick: openInvoice,
        }
      : undefined,
  };

  return <BillingOwnerCard view={view} />;
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

function useOpenExternalUrl(url: string | null) {
  const { openExternal } = useTauriShellActions();

  return useCallback(() => {
    if (!url) {
      return;
    }
    void openExternal(url);
  }, [openExternal, url]);
}
