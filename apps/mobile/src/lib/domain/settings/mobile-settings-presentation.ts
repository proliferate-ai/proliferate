import { mobileCloudSettingsSections } from "@proliferate/product-domain/settings/cloud-settings";

export interface MobileSettingsAccountSummary {
  initials: string;
  name: string;
  handle: string;
}

export interface MobileBillingPlanSummary {
  plan: string;
  isPaidCloud: boolean;
  proBillingEnabled: boolean;
  hasUnlimitedCloudHours?: boolean | null;
  remainingManagedCloudHours?: number | null;
  remainingSandboxHours?: number | null;
  startBlocked?: boolean | null;
  paymentHealthy?: boolean | null;
}

export function mobileSectionLabels(): Record<"account" | "environments" | "organization" | "billing", string> {
  const labels = new Map(
    mobileCloudSettingsSections().map((section) => [section.id, section.label]),
  );
  return {
    account: labels.get("account") ?? "Account",
    environments: labels.get("environments") ?? "Environments",
    organization: labels.get("organization") ?? "Organization",
    billing: labels.get("billing") ?? "Billing",
  };
}

export function billingPlanTitle(
  plan: MobileBillingPlanSummary | null | undefined,
  loading: boolean,
  failed: boolean,
): string {
  if (failed) {
    return "Plan";
  }
  if (loading && !plan) {
    return "Plan";
  }
  if (!plan) {
    return "Plan";
  }
  return planLabel(plan.plan);
}

export function billingUsageLine(
  plan: MobileBillingPlanSummary | null | undefined,
  loading: boolean,
  failed: boolean,
): string {
  if (failed) {
    return "Could not load billing";
  }
  if (loading && !plan) {
    return "Loading";
  }
  if (!plan) {
    return "Unavailable";
  }
  const hours = (
    plan.proBillingEnabled && plan.isPaidCloud
      ? plan.remainingManagedCloudHours
      : plan.remainingSandboxHours
  ) ?? null;
  if (hours === null || hours === undefined) {
    return "Unlimited runtime";
  }
  return `${Math.max(0, Math.round(hours * 10) / 10)}h remaining`;
}

export function billingHealthValue(
  plan: MobileBillingPlanSummary | null | undefined,
): string | undefined {
  if (!plan) {
    return undefined;
  }
  if (plan.startBlocked) {
    return "Blocked";
  }
  if (!plan.paymentHealthy) {
    return "Attention";
  }
  return undefined;
}

export function billingHealthTone(
  plan: MobileBillingPlanSummary | null | undefined,
): "muted" | "success" | "warning" {
  if (!plan) {
    return "muted";
  }
  if (plan.startBlocked) {
    return "warning";
  }
  if (!plan.paymentHealthy) {
    return "warning";
  }
  return "muted";
}

export function initialsForMobileSettingsName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const initials = parts.slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
  return initials || "P";
}

function planLabel(plan: string): string {
  const trimmed = plan?.trim();
  if (!trimmed) {
    return "Plan";
  }
  return trimmed
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}
