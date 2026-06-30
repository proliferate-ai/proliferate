import { useEffect, useState } from "react";
import type { BillingReturnSurface, CloudOwnerSelection } from "@proliferate/cloud-sdk";
import {
  useCloudBilling,
  useCloudBillingActions,
} from "@proliferate/cloud-sdk-react";
import {
  BillingOwnerCard,
  type BillingOwnerCardView,
} from "@proliferate/product-ui/billing/BillingOwnerCard";
import type {
  BillingActionView,
  BillingPlanView,
} from "@proliferate/product-ui/billing/BillingSettingsPane";

interface BillingOwnerControllerProps {
  title: string;
  description: string;
  iconKind: "personal" | "organization";
  owner?: CloudOwnerSelection;
  checkoutReturnState?: "success" | "cancel" | null;
  actionsEnabled: boolean;
  accountCreditsOnly?: boolean;
  enabled: boolean;
  billingReturnSurface: BillingReturnSurface;
  onOpenUrl: (url: string) => void | Promise<void>;
}

export function BillingOwnerController({
  title,
  description,
  iconKind,
  owner,
  checkoutReturnState,
  actionsEnabled,
  accountCreditsOnly = false,
  enabled,
  billingReturnSurface,
  onOpenUrl,
}: BillingOwnerControllerProps) {
  const billing = useCloudBilling(owner, enabled);
  const billingActions = useCloudBillingActions(owner, { returnSurface: billingReturnSurface });
  const billingPlan = billing.data;
  const [actionError, setActionError] = useState<string | null>(null);
  const invoiceUrl = billingPlan?.hostedInvoiceUrl ?? null;

  useEffect(() => {
    if (checkoutReturnState !== "success") {
      return;
    }
    void billing.refetch();
    const timers = [1500, 4500, 9000].map((delayMs) =>
      window.setTimeout(() => {
        void billing.refetch();
      }, delayMs)
    );
    return () => {
      for (const timer of timers) {
        window.clearTimeout(timer);
      }
    };
  }, [billing.refetch, checkoutReturnState]);

  async function openBillingAction(action: "checkout" | "portal" | "refill") {
    if (!actionsEnabled) {
      return;
    }
    setActionError(null);
    try {
      const response = action === "portal"
        ? await billingActions.createBillingPortal()
        : action === "refill"
          ? await billingActions.createRefillCheckout()
          : await billingActions.createCloudCheckout();
      await onOpenUrl(response.url);
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
    manageAction: actionsEnabled && !accountCreditsOnly
      ? {
          label: "Billing portal",
          loading: billingActions.creatingBillingPortal,
          onClick: () => {
            void openBillingAction("portal");
          },
        }
      : undefined,
    upgradeAction: actionsEnabled && !accountCreditsOnly
      ? {
          label: "Upgrade to Core",
          loading: billingActions.creatingCloudCheckout,
          onClick: () => {
            void openBillingAction("checkout");
          },
        }
      : undefined,
    refillAction: actionsEnabled
      && !accountCreditsOnly
      && billingPlan?.isPaidCloud
      && !billingPlan.proBillingEnabled
      && !billingPlan.hasUnlimitedCloudHours
      ? {
          label: "Add credits",
          loading: billingActions.creatingRefillCheckout,
          onClick: () => {
            void openBillingAction("refill");
          },
        }
      : undefined,
    overageAction: actionsEnabled && !accountCreditsOnly
      ? overageActionForPlan({
          plan: billingPlan,
          loading: billingActions.updatingOverage,
          onUpdate: updateOverage,
        })
      : undefined,
    invoiceAction: actionsEnabled && !accountCreditsOnly && invoiceUrl
      ? {
          label: "View invoice",
          onClick: () => {
            void onOpenUrl(invoiceUrl);
          },
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
  plan: BillingPlanView | null | undefined;
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
      label: nextEnabled ? "Enable top up" : "Disable top up",
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
    label: nextEnabled ? "Enable top up" : "Disable top up",
    loading,
    onClick: () => {
      void onUpdate(nextEnabled);
    },
  };
}
