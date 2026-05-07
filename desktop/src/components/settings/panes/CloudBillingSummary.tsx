import { Button } from "@/components/ui/Button";
import { Switch } from "@/components/ui/Switch";
import { SettingsCard } from "@/components/settings/SettingsCard";
import {
  descriptionForStartBlockReason,
  titleForStartBlockReason,
} from "@/lib/domain/workspaces/cloud-workspace-status-presentation";
import type { BillingPlanInfo } from "@/lib/integrations/cloud/client";
import { openExternal } from "@/platform/tauri/shell";
import type { useCloudBillingActions } from "@/hooks/cloud/use-cloud-billing";

type CloudBillingActions = ReturnType<typeof useCloudBillingActions>;

interface CloudBillingSummaryProps {
  billingPlan: BillingPlanInfo;
  billingActions: CloudBillingActions;
  manageBillingLabel?: string;
  upgradeLabel?: string;
}

function formatSandboxHours(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "Unlimited";
  }

  const rounded = Math.round(Math.max(value, 0) * 100) / 100;
  const formatted = rounded.toLocaleString(undefined, {
    maximumFractionDigits: 2,
    minimumFractionDigits: Number.isInteger(rounded) ? 0 : 2,
  });
  return `${formatted} ${rounded === 1 ? "hour" : "hours"}`;
}

function formatCloudRepoUsage(
  activeCloudRepoCount: number,
  cloudRepoLimit: number | null,
): string {
  if (cloudRepoLimit === null) {
    return `${activeCloudRepoCount.toLocaleString()} active`;
  }

  return `${activeCloudRepoCount.toLocaleString()} of ${cloudRepoLimit.toLocaleString()}`;
}

function formatCents(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "No cap";
  }
  return `$${(Math.max(value, 0) / 100).toLocaleString(undefined, {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  })}`;
}

function cloudAccessStatusLabel(billingPlan: BillingPlanInfo): string {
  if (billingPlan.proBillingEnabled) {
    if (billingPlan.legacyCloudSubscription) {
      return "Legacy Cloud";
    }
    if (billingPlan.isUnlimited) {
      return "Internal unlimited";
    }
    if (billingPlan.isPaidCloud) {
      return "Pro";
    }
    return "Free trial";
  }
  if (billingPlan.isPaidCloud) {
    return "Cloud subscription";
  }
  if (billingPlan.hasUnlimitedCloudHours) {
    return "Cloud access";
  }
  return "Limited free cloud";
}

export function CloudBillingSummary({
  billingPlan,
  billingActions,
  manageBillingLabel = "Manage billing",
  upgradeLabel,
}: CloudBillingSummaryProps) {
  const hasUnlimitedHours = billingPlan.hasUnlimitedCloudHours;
  const proBillingLive = billingPlan.proBillingEnabled;
  const remainingHours = proBillingLive && billingPlan.isPaidCloud
    ? billingPlan.remainingManagedCloudHours
    : billingPlan.remainingSandboxHours;
  const repoLimit = proBillingLive
    ? billingPlan.repoEnvironmentLimit
    : billingPlan.cloudRepoLimit;
  const showProOverage = proBillingLive
    && billingPlan.isPaidCloud
    && !billingPlan.legacyCloudSubscription
    && !billingPlan.isUnlimited;

  return (
    <div className="space-y-3">
      <SettingsCard>
        <div className="space-y-4 p-3 text-sm">
          <p className="text-sm font-medium text-foreground">
            {cloudAccessStatusLabel(billingPlan)}
          </p>

          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="min-w-0">
              <dt className="text-xs text-muted-foreground">
                {proBillingLive
                  ? billingPlan.isPaidCloud
                    ? "Managed cloud left"
                    : billingPlan.isUnlimited
                      ? "Remaining"
                      : "Free trial left"
                  : hasUnlimitedHours
                  ? "Remaining"
                  : billingPlan.isPaidCloud
                    ? "Prepaid remaining"
                    : "Free hours left"}
              </dt>
              <dd className="mt-1 font-medium text-foreground">
                {formatSandboxHours(remainingHours)}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-muted-foreground">Used</dt>
              <dd className="mt-1 font-medium text-foreground">
                {formatSandboxHours(billingPlan.usedSandboxHours)}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-muted-foreground">Cloud repos</dt>
              <dd className="mt-1 font-medium text-foreground">
                {formatCloudRepoUsage(
                  billingPlan.activeCloudRepoCount,
                  repoLimit ?? null,
                )}
              </dd>
            </div>
          </dl>

          <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
            {billingPlan.isPaidCloud ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  loading={billingActions.creatingBillingPortal}
                  onClick={() => {
                    void billingActions.createBillingPortal().catch(() => undefined);
                  }}
                >
                  {manageBillingLabel}
                </Button>
                {!hasUnlimitedHours && !proBillingLive && (
                  <Button
                    type="button"
                    variant="secondary"
                    loading={billingActions.creatingRefillCheckout}
                    onClick={() => {
                      void billingActions.createRefillCheckout().catch(() => undefined);
                    }}
                  >
                    Refill 10h
                  </Button>
                )}
              </>
            ) : (
              <Button
                type="button"
                variant="primary"
                loading={billingActions.creatingCloudCheckout}
                onClick={() => {
                  void billingActions.createCloudCheckout().catch(() => undefined);
                }}
              >
                {upgradeLabel ?? (proBillingLive ? "Upgrade to Pro" : "Upgrade")}
              </Button>
            )}
          </div>
        </div>
      </SettingsCard>

      {showProOverage ? (
        <SettingsCard>
          <div className="space-y-3 p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <p className="font-medium text-foreground">Managed cloud overage</p>
                <p className="text-xs text-muted-foreground">
                  {formatCents(billingPlan.managedCloudOverageUsedCents)} used of{" "}
                  {formatCents(billingPlan.managedCloudOverageCapCents)}
                </p>
              </div>
              <Switch
                aria-label="Toggle cloud overage billing"
                checked={billingPlan.managedCloudOverageEnabled}
                disabled={billingActions.updatingOverage}
                onChange={(enabled) => {
                  void billingActions.updateOverageEnabled({ enabled }).catch(() => undefined);
                }}
              />
            </div>
          </div>
        </SettingsCard>
      ) : null}

      {!proBillingLive && billingPlan.isPaidCloud && !hasUnlimitedHours ? (
        <SettingsCard>
          <div className="p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium text-foreground">Overage billing</p>
              </div>
              <Switch
                aria-label="Toggle cloud overage billing"
                checked={billingPlan.overageEnabled}
                disabled={billingActions.updatingOverage}
                onChange={(enabled) => {
                  void billingActions.updateOverageEnabled({ enabled }).catch(() => undefined);
                }}
              />
            </div>
          </div>
        </SettingsCard>
      ) : null}

      {billingPlan.hostedInvoiceUrl && billingPlan.activeSpendHold ? (
        <SettingsCard>
          <div className="p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-muted-foreground">
                Cloud usage is paused because billing needs attention.
              </p>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  void openExternal(billingPlan.hostedInvoiceUrl!);
                }}
              >
                View invoice
              </Button>
            </div>
          </div>
        </SettingsCard>
      ) : null}

      {billingPlan.billingMode === "enforce" && billingPlan.startBlocked && (
        <SettingsCard>
          <div className="p-3 text-sm">
            <p className="font-medium text-foreground">
              {titleForStartBlockReason(billingPlan.startBlockReason)}
            </p>
            <p className="mt-1 text-muted-foreground">
              {descriptionForStartBlockReason(billingPlan.startBlockReason)}
            </p>
          </div>
        </SettingsCard>
      )}
    </div>
  );
}
