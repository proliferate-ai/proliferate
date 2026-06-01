import type { BillingGrantAllocationView, BillingPlanView } from "./billing-types";

export function planStatus(plan: BillingPlanView): {
  label: string;
  tone: "neutral" | "success" | "info" | "warning" | "destructive";
} {
  if (plan.billingMode === "enforce" && plan.startBlocked) {
    return { label: "Paused", tone: "warning" };
  }
  if (plan.legacyCloudSubscription) {
    return { label: "Legacy Cloud", tone: "info" };
  }
  if (plan.isUnlimited) {
    return { label: "Unlimited", tone: "success" };
  }
  if (plan.isPaidCloud) {
    return { label: "Team", tone: "success" };
  }
  return { label: "Free", tone: "neutral" };
}

export function runtimeUsage(plan: BillingPlanView): {
  label: string;
  primary: string;
  detail: string;
  percent: number | null;
  progressLabel: string;
} {
  const remaining = plan.proBillingEnabled && plan.isPaidCloud
    ? plan.remainingManagedCloudHours
    : plan.remainingSandboxHours;
  const included = plan.proBillingEnabled && plan.isPaidCloud
    ? plan.includedManagedCloudHours
    : plan.freeSandboxHours;
  const grantUsage = grantUsageSummary(plan.grantAllocations);
  const used = grantUsage?.consumedHours
    ?? managedUsedHours(plan)
    ?? plan.usedSandboxHours
    ?? 0;
  const total = included ?? (remaining === null || remaining === undefined ? null : used + remaining);
  const percent = total && total > 0
    ? Math.min(100, Math.max(0, (used / total) * 100))
    : null;

  return {
    label: plan.proBillingEnabled && plan.isPaidCloud ? "Managed cloud left" : "Cloud runtime left",
    primary: formatHours(remaining),
    detail: `${formatHours(used)} used${total ? ` of ${formatHours(total)}` : ""}`,
    percent,
    progressLabel: total ? `${Math.round(percent ?? 0)}% used this period` : "Usage is not capped for this plan",
  };
}

export function grantUsageSummary(
  grants: readonly BillingGrantAllocationView[] | null | undefined,
): { consumedHours: number } | null {
  const visible = visibleGrantAllocations(grants);
  if (visible.length === 0) {
    return null;
  }
  return {
    consumedHours: visible.reduce(
      (total, grant) => total + secondsToHours(grant.consumedSeconds),
      0,
    ),
  };
}

export function visibleGrantAllocations(
  grants: readonly BillingGrantAllocationView[] | null | undefined,
): BillingGrantAllocationView[] {
  return (grants ?? [])
    .filter((grant) =>
      grant.active
      || grant.consumedSeconds > 0
      || grant.remainingSeconds > 0
    )
    .sort((left, right) => Number(right.active) - Number(left.active)
      || right.consumedSeconds - left.consumedSeconds);
}

export function managedUsedHours(plan: BillingPlanView): number | null {
  if (!plan.proBillingEnabled || !plan.isPaidCloud) {
    return null;
  }
  if (
    plan.includedManagedCloudHours === null
    || plan.includedManagedCloudHours === undefined
    || plan.remainingManagedCloudHours === null
    || plan.remainingManagedCloudHours === undefined
  ) {
    return null;
  }
  return Math.max(plan.includedManagedCloudHours - plan.remainingManagedCloudHours, 0);
}

export function secondsToHours(seconds: number | null | undefined): number {
  return Math.max(seconds ?? 0, 0) / 3600;
}

export function grantTypeLabel(grantType: string): string {
  switch (grantType) {
    case "free_trial_v2":
      return "Free trial credits";
    case "free_included":
      return "Included free credits";
    case "cloud_monthly":
      return "Monthly cloud credits";
    case "pro_period":
      return "Team period credits";
    case "pro_seat_proration":
      return "Seat adjustment credits";
    case "refill_10h":
      return "Refill credits";
    default:
      return grantType.replace(/_/g, " ");
  }
}

export function overageSummary(plan: BillingPlanView): {
  title: string;
  enabled: boolean;
  description: string;
} | null {
  if (!plan.isPaidCloud || plan.isUnlimited) {
    return null;
  }
  if (plan.proBillingEnabled && !plan.legacyCloudSubscription) {
    return {
      title: "Managed cloud overage",
      enabled: plan.managedCloudOverageEnabled,
      description: `${formatCurrency(plan.managedCloudOverageUsedCents)} used of ${formatCurrency(
        plan.managedCloudOverageCapCents,
      )} at ${formatCurrency(plan.overagePricePerHourCents)} per hour.`,
    };
  }
  if (!plan.proBillingEnabled && !plan.hasUnlimitedCloudHours) {
    return {
      title: "Overage billing",
      enabled: plan.overageEnabled,
      description: "Allow additional cloud runtime after prepaid hours are exhausted.",
    };
  }
  return null;
}

export function repoLimit(plan: BillingPlanView): number | null | undefined {
  return plan.proBillingEnabled ? plan.repoEnvironmentLimit : plan.cloudRepoLimit;
}

export function formatLimit(value: number, limit: number | null | undefined): string {
  if (limit === null || limit === undefined) {
    return value.toLocaleString();
  }
  return `${value.toLocaleString()} / ${limit.toLocaleString()}`;
}

export function formatHours(value: number | null | undefined): string {
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

export function formatCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "No cap";
  }
  return `$${(Math.max(value, 0) / 100).toLocaleString(undefined, {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  })}`;
}

export function startBlockTitle(reason: string | null | undefined): string {
  switch (reason) {
    case "credits_exhausted":
      return "Included usage is exhausted";
    case "overage_disabled":
      return "Overage is disabled";
    case "cap_exhausted":
      return "Overage cap reached";
    case "payment_failed":
      return "Payment needs attention";
    case "concurrency_limit":
      return "Sandbox limit reached";
    default:
      return "Cloud usage is paused";
  }
}

export function startBlockDescription(reason: string | null | undefined): string {
  switch (reason) {
    case "credits_exhausted":
      return "Included cloud runtime has been used for this period.";
    case "overage_disabled":
      return "Turn on capped overage or wait for the next billing period.";
    case "cap_exhausted":
      return "Raise the overage cap or wait for the next billing period.";
    case "payment_failed":
      return "Update the payment method before starting more managed cloud work.";
    case "concurrency_limit":
      return "Stop an active sandbox before starting another managed cloud workspace.";
    default:
      return "Resolve billing before starting more managed cloud work.";
  }
}
