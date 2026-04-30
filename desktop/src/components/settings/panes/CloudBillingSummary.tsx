import { Button } from "@/components/ui/Button";
import { Switch } from "@/components/ui/Switch";
import { SettingsCard } from "@/components/settings/SettingsCard";
import {
  descriptionForStartBlockReason,
  titleForStartBlockReason,
} from "@/lib/domain/workspaces/cloud-workspace-status";
import type { BillingPlanInfo } from "@/lib/integrations/cloud/client";
import { openExternal } from "@/platform/tauri/shell";
import type { useCloudBillingActions } from "@/hooks/cloud/use-cloud-billing";

type CloudBillingActions = ReturnType<typeof useCloudBillingActions>;

const PAID_CLOUD_REPO_LIMIT_COPY = 4;

interface CloudBillingSummaryProps {
  billingPlan: BillingPlanInfo;
  billingActions: CloudBillingActions;
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

function formatActiveSandboxes(
  activeSandboxCount: number,
  concurrentSandboxLimit: number | null,
): string {
  if (concurrentSandboxLimit === null) {
    return `${activeSandboxCount.toLocaleString()} active`;
  }

  return `${activeSandboxCount.toLocaleString()} of ${concurrentSandboxLimit.toLocaleString()}`;
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

function formatCloudRepoLimit(value: number | null): string {
  if (value === null) {
    return "unlimited cloud repos";
  }

  const formatted = value.toLocaleString();
  return `${formatted} ${value === 1 ? "cloud repo" : "cloud repos"}`;
}

export function CloudBillingSummary({
  billingPlan,
  billingActions,
}: CloudBillingSummaryProps) {
  const hasUnlimitedHours = billingPlan.hasUnlimitedCloudHours;

  return (
    <div className="space-y-3">
      <SettingsCard>
        <div className="p-3 text-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-medium text-foreground">
                {hasUnlimitedHours
                  ? "Unlimited cloud"
                  : billingPlan.isPaidCloud
                    ? "$200/month Cloud"
                    : "Limited free cloud"}
              </p>
              <p className="mt-1 text-muted-foreground">
                {hasUnlimitedHours
                  ? `Unlimited usage across ${formatCloudRepoLimit(billingPlan.cloudRepoLimit)}.`
                  : billingPlan.isPaidCloud
                    ? "Monthly credits and refills are consumed before overage."
                    : `Free includes limited sandbox-hours for ${formatCloudRepoLimit(
                        billingPlan.cloudRepoLimit,
                      )}. Upgrade for unlimited usage across ${formatCloudRepoLimit(
                        PAID_CLOUD_REPO_LIMIT_COPY,
                      )}.`}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
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
                    Manage billing
                  </Button>
                  {!hasUnlimitedHours && (
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
                  Upgrade to unlimited
                </Button>
              )}
            </div>
          </div>

          <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
            <div className="min-w-0">
              <dt className="text-xs text-muted-foreground">
                {hasUnlimitedHours
                  ? "Remaining"
                  : billingPlan.isPaidCloud
                    ? "Prepaid remaining"
                    : "Free hours left"}
              </dt>
              <dd className="mt-1 font-medium text-foreground">
                {formatSandboxHours(billingPlan.remainingSandboxHours)}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-muted-foreground">Used</dt>
              <dd className="mt-1 font-medium text-foreground">
                {formatSandboxHours(billingPlan.usedSandboxHours)}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-muted-foreground">
                {hasUnlimitedHours
                  ? "Included total"
                  : billingPlan.isPaidCloud
                    ? "Prepaid total"
                    : "Free hour limit"}
              </dt>
              <dd className="mt-1 font-medium text-foreground">
                {formatSandboxHours(billingPlan.freeSandboxHours)}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-muted-foreground">Cloud repos</dt>
              <dd className="mt-1 font-medium text-foreground">
                {formatCloudRepoUsage(
                  billingPlan.activeCloudRepoCount,
                  billingPlan.cloudRepoLimit,
                )}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-muted-foreground">Active sandboxes</dt>
              <dd className="mt-1 font-medium text-foreground">
                {formatActiveSandboxes(
                  billingPlan.activeSandboxCount,
                  billingPlan.concurrentSandboxLimit,
                )}
              </dd>
            </div>
          </dl>
        </div>
      </SettingsCard>

      {billingPlan.isPaidCloud && !hasUnlimitedHours && (
        <SettingsCard>
          <div className="p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium text-foreground">
                  {billingPlan.overageEnabled ? "Overage billing on" : "Overage billing off"}
                </p>
                <p className="mt-1 text-muted-foreground">
                  {billingPlan.overageEnabled
                    ? "Additional usage is billed at $2/hour in 10-hour blocks."
                    : "Cloud pauses when included/refill hours run out."}
                </p>
              </div>
              <Switch
                aria-label="Toggle cloud overage billing"
                checked={billingPlan.overageEnabled}
                disabled={billingActions.updatingOverage}
                onChange={(enabled) => {
                  void billingActions.updateOverageEnabled(enabled).catch(() => undefined);
                }}
              />
            </div>
          </div>
        </SettingsCard>
      )}

      {billingPlan.hostedInvoiceUrl && (
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
      )}

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
