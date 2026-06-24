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
import { SettingsCard } from "@proliferate/product-ui/settings/SettingsCard";
import { SettingsCardRow } from "@proliferate/product-ui/settings/SettingsCardRow";
import { SettingsPageHeader } from "@proliferate/product-ui/settings/SettingsPageHeader";
import { Button } from "@proliferate/ui/primitives/Button";
import { BillingOwnerController } from "./BillingOwnerController";

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

  function openPricingPage() {
    if (!onOpenPricingPage) {
      return;
    }
    void onOpenPricingPage();
  }

  const currentPlanKey = planKeyForBilling(comparisonBilling.data);
  const comparisonActionDisabled = !enabled
    || organizationLoading
    || (organization?.canManageBilling ? comparisonBilling.isLoading : false);
  const coreActionLoading = comparisonBilling.data?.isPaidCloud
    ? comparisonActions.creatingBillingPortal
    : comparisonActions.creatingCloudCheckout;

  return (
    <section className="space-y-6">
      <SettingsPageHeader
        title="Plan + billing"
        description="Review account credits, organization plan, Core checkout, top up, and Stripe billing portal access."
      />
      <BillingSettingsPane
        checkoutReturnState={checkoutReturnState}
        currentPlanKey={currentPlanKey}
        planComparisonAction={{
          label: !organization ? "Create organization" : "Manage plan",
          disabled: comparisonActionDisabled,
          onClick: () => {
            openPlanManagement();
          },
        }}
        enterprisePlanAction={onOpenPricingPage ? {
          label: "Request trial",
          onClick: openPricingPage,
        } : undefined}
        planManagementDialog={organization?.canManageBilling ? {
          open: planManagementOpen,
          onClose: () => {
            setPlanManagementOpen(false);
          },
          currentPlanKey,
          organizationName: organization.name,
          coreAction: {
            label: comparisonBilling.data?.isPaidCloud ? "Manage Core membership" : "Upgrade to Core",
            loading: coreActionLoading,
            disabled: comparisonActionDisabled,
            onClick: () => {
              void openComparisonBillingAction(
                comparisonBilling.data?.isPaidCloud ? "portal" : "checkout",
              );
            },
          },
          portalAction: comparisonBilling.data?.isPaidCloud
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
        {comparisonActionError && !planManagementOpen ? (
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
            <SettingsCardRow label="Organization billing" description="Loading organization..." />
          </SettingsCard>
        ) : null}

        {!organizationLoading && !organization ? (
          <SettingsCard>
            <SettingsCardRow
              label="Organization billing"
              description="Create an organization from settings to add Core billing and org admin controls."
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
          <BillingOwnerController
            key={organization.id}
            title={`${organization.name} billing`}
            description="Applies to organization cloud workspaces, shared workflows, and Core credit usage."
            iconKind="organization"
            owner={{ ownerScope: "organization", organizationId: organization.id }}
            checkoutReturnState={checkoutReturnState}
            actionsEnabled
            enabled={enabled}
            billingReturnSurface={billingReturnSurface}
            onOpenUrl={onOpenUrl}
          />
        ) : organization ? (
          <SettingsCard>
            <SettingsCardRow
              label={`${organization.name} billing`}
              description="Organization billing is managed by owners and admins."
            />
          </SettingsCard>
        ) : null}
      </BillingSettingsPane>
    </section>
  );
}

function planKeyForBilling(plan: BillingPlanView | null | undefined) {
  if (!plan) {
    return null;
  }
  if (plan.isUnlimited && !plan.isPaidCloud) {
    return "enterprise";
  }
  return plan.isPaidCloud ? "core" : "free";
}
