import { useMemo } from "react";
import { Button } from "@/components/ui/Button";
import { Switch } from "@/components/ui/Switch";
import { SettingsCard } from "@/components/settings/SettingsCard";
import { useCloudBilling, useCloudBillingActions } from "@/hooks/cloud/use-cloud-billing";
import type { CloudOwnerSelection } from "@/lib/access/cloud/billing";
import type { BillingPlanInfo } from "@/lib/access/cloud/client";

type OrganizationRole = "owner" | "admin" | "member" | null;

interface OrganizationBillingSectionProps {
  organizationId: string;
  organizationName: string;
  canManageBilling: boolean;
  currentMemberRole: OrganizationRole;
}

function formatHours(value: number | null | undefined): string {
  if (value === null || value === undefined) return "Not available";
  const rounded = Math.round(Math.max(value, 0) * 100) / 100;
  return `${rounded.toLocaleString(undefined, {
    maximumFractionDigits: 2,
    minimumFractionDigits: Number.isInteger(rounded) ? 0 : 2,
  })} ${rounded === 1 ? "hour" : "hours"}`;
}

function formatCents(value: number | null | undefined): string {
  if (value === null || value === undefined) return "Not available";
  return `$${(Math.max(value, 0) / 100).toLocaleString(undefined, {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  })}`;
}

function formatCentsPerHour(value: number | null | undefined): string {
  const formatted = formatCents(value);
  return formatted === "Not available" ? formatted : `${formatted} per hour`;
}

function planLabel(plan: BillingPlanInfo): string {
  if (plan.legacyCloudSubscription) return "Legacy Cloud";
  if (plan.isUnlimited) return "Internal unlimited";
  if (plan.isPaidCloud) return "Pro";
  return plan.proBillingEnabled ? "Free" : "Unavailable";
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-medium text-foreground">{value}</dd>
    </div>
  );
}

export function OrganizationBillingSection({
  organizationId,
  organizationName,
  canManageBilling,
  currentMemberRole,
}: OrganizationBillingSectionProps) {
  const owner = useMemo<CloudOwnerSelection>(
    () => ({ ownerScope: "organization", organizationId }),
    [organizationId],
  );
  const billingQuery = useCloudBilling(owner);
  const billingActions = useCloudBillingActions(owner);
  const billingPlan = billingQuery.data;

  return (
    <section className="space-y-2">
      <div className="space-y-0.5">
        <h2 className="text-sm font-medium text-foreground">Organization billing</h2>
        <p className="text-sm text-muted-foreground">{organizationName}</p>
      </div>
      <SettingsCard>
        {billingQuery.isLoading && !billingPlan ? (
          <div className="p-3 text-sm text-muted-foreground">Loading billing...</div>
        ) : null}

        {billingQuery.isError ? (
          <div className="flex items-center justify-between gap-3 p-3">
            <div className="text-sm text-muted-foreground">
              Billing details could not be loaded.
            </div>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                void billingQuery.refetch();
              }}
            >
              Retry
            </Button>
          </div>
        ) : null}

        {!billingQuery.isLoading && !billingQuery.isError && !billingPlan ? (
          <div className="p-3 text-sm text-muted-foreground">
            Billing details are not available for this organization.
          </div>
        ) : null}

        {billingPlan ? (
          <div className="space-y-4 p-3 text-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <p className="font-medium text-foreground">{planLabel(billingPlan)}</p>
                <p className="text-xs text-muted-foreground">
                  {canManageBilling
                    ? "Organization Pro billing is managed here."
                    : "Billing is managed by organization owners and admins."}
                  {currentMemberRole ? ` Your role is ${currentMemberRole}.` : ""}
                </p>
              </div>
              {canManageBilling ? (
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  {billingPlan.isPaidCloud ? (
                    <Button
                      type="button"
                      variant="outline"
                      loading={billingActions.creatingBillingPortal}
                      onClick={() => {
                        void billingActions.createBillingPortal().catch(() => undefined);
                      }}
                    >
                      Manage organization billing
                    </Button>
                  ) : billingPlan.proBillingEnabled ? (
                    <Button
                      type="button"
                      variant="primary"
                      loading={billingActions.creatingCloudCheckout}
                      onClick={() => {
                        void billingActions.createCloudCheckout().catch(() => undefined);
                      }}
                    >
                      Upgrade organization
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </div>

            <dl className="grid grid-cols-1 gap-3 border-t border-border/60 pt-3 sm:grid-cols-3">
              <Stat label="Plan" value={planLabel(billingPlan)} />
              <Stat
                label="Billing policy"
                value={billingPlan.proBillingEnabled ? "Pro billing" : "Legacy billing"}
              />
              <Stat
                label="Billable seats"
                value={
                  billingPlan.isPaidCloud && billingPlan.billableSeatCount !== null
                  && typeof billingPlan.billableSeatCount === "number"
                    ? billingPlan.billableSeatCount.toLocaleString()
                    : "N/A"
                }
              />
              <Stat
                label="Included managed cloud"
                value={formatHours(billingPlan.includedManagedCloudHours)}
              />
              <Stat
                label="Remaining managed cloud"
                value={formatHours(billingPlan.remainingManagedCloudHours)}
              />
              <Stat
                label="Overage used"
                value={formatCents(billingPlan.managedCloudOverageUsedCents)}
              />
              <Stat
                label="Overage cap"
                value={formatCents(billingPlan.managedCloudOverageCapCents)}
              />
              <Stat
                label="Overage price"
                value={formatCentsPerHour(billingPlan.overagePricePerHourCents)}
              />
              <Stat
                label="Legacy subscription"
                value={billingPlan.legacyCloudSubscription ? "Yes" : "No"}
              />
            </dl>

            {billingPlan.proBillingEnabled
              && billingPlan.isPaidCloud
              && !billingPlan.legacyCloudSubscription
              && !billingPlan.isUnlimited ? (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-3">
                <div className="min-w-0 space-y-1">
                  <p className="font-medium text-foreground">Managed cloud overage</p>
                  <p className="text-xs text-muted-foreground">
                    {formatCents(billingPlan.managedCloudOverageUsedCents)} used of{" "}
                    {formatCents(billingPlan.managedCloudOverageCapCents)} at{" "}
                    {formatCentsPerHour(billingPlan.overagePricePerHourCents)}.
                  </p>
                </div>
                <Switch
                  aria-label="Toggle organization managed cloud overage billing"
                  checked={billingPlan.managedCloudOverageEnabled}
                  disabled={!canManageBilling || billingActions.updatingOverage}
                  onChange={(enabled) => {
                    void billingActions.updateOverageEnabled({ enabled }).catch(() => undefined);
                  }}
                />
              </div>
            ) : null}
          </div>
        ) : null}
      </SettingsCard>
    </section>
  );
}
