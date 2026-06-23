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
import {
  BillingSettingsPane,
  type BillingActionView,
  type BillingPlanView,
} from "@proliferate/product-ui/billing/BillingSettingsPane";
import { SettingsCard } from "@proliferate/product-ui/settings/SettingsCard";
import { SettingsCardRow } from "@proliferate/product-ui/settings/SettingsCardRow";
import { SettingsPageHeader } from "@proliferate/product-ui/settings/SettingsPageHeader";
import { Button } from "@proliferate/ui/primitives/Button";

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
  onOpenOrganizationSettings: () => void;
}

export function BillingSettingsSurface({
  organization,
  organizationLoading = organization?.loading ?? false,
  enabled = true,
  billingReturnSurface = "web",
  checkoutReturnState = null,
  onOpenUrl,
  onOpenOrganizationSettings,
}: BillingSettingsSurfaceProps) {
  const billingReturnOptions = { returnSurface: billingReturnSurface };
  const comparisonOwner = organization?.canManageBilling
    ? { ownerScope: "organization" as const, organizationId: organization.id }
    : undefined;
  const comparisonBilling = useCloudBilling(comparisonOwner, enabled);
  const comparisonActions = useCloudBillingActions(comparisonOwner, billingReturnOptions);
  const [comparisonActionError, setComparisonActionError] = useState<string | null>(null);

  useEffect(() => {
    if (checkoutReturnState !== "success") {
      return;
    }
    void comparisonBilling.refetch();
  }, [checkoutReturnState, comparisonBilling.refetch]);

  async function openComparisonBillingAction() {
    setComparisonActionError(null);
    if (!organization) {
      onOpenOrganizationSettings();
      return;
    }
    if (!organization.canManageBilling) {
      setComparisonActionError("Team billing is managed by owners and admins.");
      return;
    }
    try {
      const response = comparisonBilling.data?.isPaidCloud
        ? await comparisonActions.createBillingPortal()
        : await comparisonActions.createCloudCheckout();
      await onOpenUrl(response.url);
    } catch (error) {
      setComparisonActionError(
        error instanceof Error ? error.message : "Billing action could not start.",
      );
    }
  }

  return (
    <section className="space-y-6">
      <SettingsPageHeader
        title="Plan + billing"
        description="Review account credits and manage organization plan, seats, cloud runtime, auto top up, overage, and plan changes."
      />
      <BillingSettingsPane
        checkoutReturnState={checkoutReturnState}
        currentPlanKey={planKeyForBilling(comparisonBilling.data)}
        planComparisonAction={{
          label: !organization
            ? "Create Team"
            : comparisonBilling.data?.isPaidCloud
              ? "Manage Team billing"
              : "Upgrade Team",
          loading: comparisonBilling.data?.isPaidCloud
            ? comparisonActions.creatingBillingPortal
            : comparisonActions.creatingCloudCheckout,
          disabled: !enabled
            || organizationLoading
            || (organization?.canManageBilling ? comparisonBilling.isLoading : false),
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
          title="Account credits"
          description="Included cloud usage and onboarding credits for work you launch from this account."
          iconKind="personal"
          checkoutReturnState={checkoutReturnState}
          actionsEnabled={false}
          accountCreditsOnly
          enabled={enabled}
          billingReturnSurface={billingReturnSurface}
          onOpenUrl={onOpenUrl}
        />

        {organizationLoading ? (
          <SettingsCard>
            <SettingsCardRow label="Team billing" description="Loading team..." />
          </SettingsCard>
        ) : null}

        {!organizationLoading && !organization ? (
          <SettingsCard>
            <SettingsCardRow
              label="Team billing"
              description="Create a team from Organization settings to add seats, organization cloud, Slack work, and org admin controls."
            >
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={onOpenOrganizationSettings}
              >
                Open Organization
              </Button>
            </SettingsCardRow>
          </SettingsCard>
        ) : null}

        {organization?.canManageBilling ? (
          <>
            <BillingOwnerController
              key={organization.id}
              title={`${organization.name} billing`}
              description="Applies to organization cloud workspaces, team workflows, Slack sessions, and cloud usage."
              iconKind="organization"
              owner={{ ownerScope: "organization", organizationId: organization.id }}
              checkoutReturnState={checkoutReturnState}
              actionsEnabled
              enabled={enabled}
              billingReturnSurface={billingReturnSurface}
              onOpenUrl={onOpenUrl}
            />
            <SettingsCard>
              <SettingsCardRow
                label="Auto top up"
                description="Automatically refill organization-managed credits when balance reaches a threshold."
              >
                <Button type="button" size="sm" variant="secondary" disabled>
                  Configure
                </Button>
              </SettingsCardRow>
            </SettingsCard>
          </>
        ) : organization ? (
          <SettingsCard>
            <SettingsCardRow
              label={`${organization.name} billing`}
              description="Team billing is managed by owners and admins."
            />
          </SettingsCard>
        ) : null}
      </BillingSettingsPane>
    </section>
  );
}

function BillingOwnerController({
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
}: {
  title: string;
  description: string;
  iconKind: "personal" | "organization";
  owner?: CloudOwnerSelection;
  checkoutReturnState?: BillingCheckoutReturnState;
  actionsEnabled: boolean;
  accountCreditsOnly?: boolean;
  enabled: boolean;
  billingReturnSurface: BillingReturnSurface;
  onOpenUrl: (url: string) => void | Promise<void>;
}) {
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
          label: "Manage billing",
          loading: billingActions.creatingBillingPortal,
          onClick: () => {
            void openBillingAction("portal");
          },
        }
      : undefined,
    upgradeAction: actionsEnabled && !accountCreditsOnly
      ? {
          label: "Upgrade Team",
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
          label: "Refill 10h",
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

function planKeyForBilling(plan: BillingPlanView | null | undefined) {
  if (!plan) {
    return null;
  }
  if (plan.isUnlimited && !plan.isPaidCloud) {
    return "enterprise";
  }
  return plan.isPaidCloud ? "team" : "free";
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
