import type { ReactNode } from "react";
import { SettingsCard } from "@/components/settings/shared/SettingsCard";
import { SettingsPageHeader } from "@/components/settings/shared/SettingsPageHeader";
import { CloudBillingSummary } from "@/components/settings/panes/CloudBillingSummary";
import { OrganizationBillingSection } from "@/components/settings/panes/billing/OrganizationBillingSection";
import { Button } from "@proliferate/ui/primitives/Button";
import { useCloudBilling, useCloudBillingActions } from "@/hooks/cloud/facade/use-cloud-billing";
import { useActiveOrganization } from "@/hooks/organizations/facade/use-active-organization";
import { useIsAdmin } from "@/hooks/access/cloud/organizations/use-is-admin";

export function BillingPane() {
  const personalBillingQuery = useCloudBilling();
  const personalBillingPlan = personalBillingQuery.data;
  const personalBillingActions = useCloudBillingActions();
  const { activeOrganization, activeOrganizationId } = useActiveOrganization();
  const admin = useIsAdmin(activeOrganizationId);
  const canManageBilling = admin.isAdmin;

  return (
    <section className="space-y-6">
      <SettingsPageHeader
        title="Billing"
        description="Manage billing for the active organization and your personal account."
      />

      {activeOrganization ? (
        <OrganizationBillingSection
          organizationId={activeOrganization.id}
          organizationName={activeOrganization.name}
          canManageBilling={canManageBilling}
          currentMemberRole={admin.role}
        />
      ) : null}

      <BillingPaneSection
        title="Personal billing"
        description="Applies only to your personal cloud usage, not the active organization."
      >
        {personalBillingPlan ? (
          <CloudBillingSummary
            billingPlan={personalBillingPlan}
            billingActions={personalBillingActions}
            manageBillingLabel="Manage personal billing"
            upgradeLabel="Upgrade personal account"
          />
        ) : personalBillingQuery.isError ? (
          <SettingsCard>
            <div className="flex items-center justify-between gap-3 p-3">
              <div className="text-sm text-muted-foreground">
                Personal billing details could not be loaded.
              </div>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  void personalBillingQuery.refetch();
                }}
              >
                Retry
              </Button>
            </div>
          </SettingsCard>
        ) : (
          <SettingsCard>
            <div className="p-3 text-sm text-muted-foreground">
              Personal billing details are not available.
            </div>
          </SettingsCard>
        )}
      </BillingPaneSection>
    </section>
  );
}

function BillingPaneSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2">
      <div className="space-y-0.5">
        <h2 className="text-sm font-medium text-foreground">{title}</h2>
        {description ? (
          <p className="text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}
