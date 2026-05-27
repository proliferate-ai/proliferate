import { useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";

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
import { Button } from "@proliferate/ui/primitives/Button";
import {
  useCloudBilling,
  useCloudBillingActions,
  useCurrentTeam,
} from "@proliferate/cloud-sdk-react";

import { routes } from "../../../config/routes";

export function BillingSettingsSection() {
  const navigate = useNavigate();
  const location = useLocation();
  const currentTeam = useCurrentTeam();
  const [searchParams] = useSearchParams();
  const team = currentTeam.data ?? null;
  const teamRole = team?.membership?.role ?? null;
  const canManageTeam = Boolean(
    team?.membership?.status === "active" && (teamRole === "owner" || teamRole === "admin"),
  );
  const comparisonOwner = team && canManageTeam
    ? { ownerScope: "organization" as const, organizationId: team.id }
    : undefined;
  const comparisonBilling = useCloudBilling(comparisonOwner);
  const comparisonActions = useCloudBillingActions(comparisonOwner);
  const [comparisonActionError, setComparisonActionError] = useState<string | null>(null);
  const checkoutReturnState = checkoutReturnStateFromParams(searchParams);

  async function openComparisonBillingAction() {
    setComparisonActionError(null);
    if (!team) {
      navigate(routes.settingsSection("organization"), {
        state: settingsNavigationState(location.state),
      });
      return;
    }
    if (!canManageTeam) {
      setComparisonActionError("Team billing is managed by owners and admins.");
      return;
    }
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
        description="Review account credits and manage Team billing, seats, shared cloud runtime, overage, and plan changes."
      />
      <BillingSettingsPane
        checkoutReturnState={checkoutReturnState}
        currentPlanKey={planKeyForBilling(comparisonBilling.data)}
        planComparisonAction={{
          label: !team
            ? "Create Team"
            : comparisonBilling.data?.isPaidCloud
              ? "Manage Team billing"
              : "Upgrade Team",
          loading: comparisonBilling.data?.isPaidCloud
            ? comparisonActions.creatingBillingPortal
            : comparisonActions.creatingCloudCheckout,
          disabled: currentTeam.isLoading || (team && canManageTeam ? comparisonBilling.isLoading : false),
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
          accountCreditsOnly
        />

        {currentTeam.isLoading ? (
          <SettingsCard>
            <SettingsCardRow label="Team billing" description="Loading team..." />
          </SettingsCard>
        ) : null}

        {!currentTeam.isLoading && !team ? (
          <SettingsCard>
            <SettingsCardRow
              label="Team billing"
              description="Create a team from Organization settings to add seats, shared cloud, Slack work, and org admin controls."
            >
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => navigate(routes.settingsSection("organization"), {
                  state: settingsNavigationState(location.state),
                })}
              >
                Open Organization
              </Button>
            </SettingsCardRow>
          </SettingsCard>
        ) : null}

        {team && canManageTeam ? (
          <BillingOwnerController
            key={team.id}
            title={`${team.name} billing`}
            description="Applies to shared cloud workspaces, team automations, Slack sessions, and shared sandbox usage."
            iconKind="organization"
            owner={{ ownerScope: "organization", organizationId: team.id }}
          />
        ) : team ? (
          <SettingsCard>
            <SettingsCardRow
              label={`${team.name} billing`}
              description="Team billing is managed by owners and admins."
            />
          </SettingsCard>
        ) : null}
      </BillingSettingsPane>
    </section>
  );
}

function settingsNavigationState(state: unknown): unknown {
  if (
    state &&
    typeof state === "object" &&
    "backgroundLocation" in state
  ) {
    return state;
  }
  return undefined;
}

function BillingOwnerController({
  title,
  description,
  iconKind,
  owner,
  accountCreditsOnly = false,
}: {
  title: string;
  description: string;
  iconKind: "personal" | "organization";
  owner?: CloudOwnerSelection;
  accountCreditsOnly?: boolean;
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
    manageAction: !accountCreditsOnly
      ? {
          label: "Manage billing",
          loading: billingActions.creatingBillingPortal,
          onClick: () => {
            void openBillingAction("portal");
          },
        }
      : undefined,
    upgradeAction: !accountCreditsOnly
      ? {
          label: "Upgrade Team",
          loading: billingActions.creatingCloudCheckout,
          onClick: () => {
            void openBillingAction("checkout");
          },
        }
      : undefined,
    refillAction: !accountCreditsOnly
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
    overageAction: accountCreditsOnly
      ? undefined
      : overageActionForPlan({
          plan: billingPlan,
          loading: billingActions.updatingOverage,
          onUpdate: updateOverage,
        }),
    invoiceAction: !accountCreditsOnly && invoiceUrl
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
