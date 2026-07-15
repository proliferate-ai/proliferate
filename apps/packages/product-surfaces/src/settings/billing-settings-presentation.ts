import type { LlmBalance } from "@proliferate/cloud-sdk";
import type { BillingPlanView } from "@proliferate/product-ui/billing/BillingSettingsPane";
import type { BillingPlanPresentation } from "./BillingManagementCards";
import type { BillingUnitBalancePresentation } from "./BillingUsageUnitsSection";

const COMPUTE_UNIT_COPY = {
  kind: "compute",
  title: "Compute units",
  description: "Used by hosted runtime, sandboxes, and execution time.",
  topUpLabel: "Add compute units",
  lowBalanceCopy: "Need more runtime capacity? Add compute units any time.",
} as const;

const LLM_UNIT_COPY = {
  kind: "llm",
  title: "LLM credits",
  description: "Used by model gateway calls, inference-backed tools, and managed model access.",
  topUpLabel: "Add LLM credits",
  lowBalanceCopy: "Need more model usage? Add LLM credits any time.",
} as const;

export type BillingPlanViewKey = "free" | "core" | "enterprise";

export function planKeyForBilling(
  plan: BillingPlanView | null | undefined,
): BillingPlanViewKey | null {
  if (!plan) {
    return null;
  }
  if (plan.isUnlimited && !plan.isPaidCloud) {
    return "enterprise";
  }
  return plan.isPaidCloud ? "core" : "free";
}

export function planSummary(
  planKey: BillingPlanViewKey | null,
  plan: BillingPlanView,
): BillingPlanPresentation {
  const status = planStatusSummary(plan);
  if (planKey === "enterprise") {
    return {
      name: "Enterprise plan",
      price: "custom",
      ...status,
    };
  }
  if (planKey === "core") {
    return {
      name: "Core plan",
      price: "$20/month",
      ...status,
    };
  }
  return {
    name: "Free plan",
    price: "$0/month",
    ...status,
  };
}

export function billingUnitBalances({
  plan,
  planLoading,
  planError,
  onRetryPlan,
  llmBalance,
  llmBalanceLoading,
  llmBalanceError,
  onRetryLlmBalance,
  enabled,
}: {
  plan: BillingPlanView | null | undefined;
  planLoading: boolean;
  planError: boolean;
  onRetryPlan: () => void;
  llmBalance: LlmBalance | null | undefined;
  llmBalanceLoading: boolean;
  llmBalanceError: boolean;
  onRetryLlmBalance: () => void;
  enabled: boolean;
}): BillingUnitBalancePresentation[] {
  return [
    computeBalanceSummary(plan, {
      enabled,
      loading: planLoading,
      error: planError,
      onRetry: onRetryPlan,
    }),
    llmBalanceSummary(llmBalance, {
      enabled,
      loading: llmBalanceLoading,
      error: llmBalanceError,
      onRetry: onRetryLlmBalance,
    }),
  ];
}

function planStatusSummary(plan: BillingPlanView): Pick<
  BillingPlanPresentation,
  "badge" | "badgeTone"
> {
  if (plan.billingMode === "enforce" && plan.startBlocked) {
    return { badge: "Paused", badgeTone: "warning" };
  }
  if (plan.paymentHealthy === false) {
    return { badge: "Payment issue", badgeTone: "destructive" };
  }
  if (plan.legacyCloudSubscription) {
    return { badge: "Legacy Cloud", badgeTone: "info" };
  }
  if (plan.isUnlimited) {
    return { badge: "Unlimited", badgeTone: "success" };
  }
  return {
    badge: "Active",
    badgeTone: plan.isPaidCloud ? "success" : "neutral",
  };
}

function llmBalanceSummary(
  llmBalance: LlmBalance | null | undefined,
  query: BillingUnitQueryState,
): BillingUnitBalancePresentation {
  const unavailable = unavailableUnitBalance(LLM_UNIT_COPY, query, Boolean(llmBalance));
  if (unavailable) {
    return unavailable;
  }
  const granted = Math.max(llmBalance?.grantedUsd ?? 0, 0);
  const used = Math.max(llmBalance?.usedUsd ?? 0, 0);
  const remaining = Math.max(llmBalance?.remainingUsd ?? 0, 0);
  return {
    ...LLM_UNIT_COPY,
    purchased: formatUsd(granted),
    available: formatUsd(remaining),
    used: formatUsd(used),
    availablePercent: granted > 0 ? Math.round((remaining / granted) * 100) : null,
    state: "ready",
  };
}

function computeBalanceSummary(
  plan: BillingPlanView | null | undefined,
  query: BillingUnitQueryState,
): BillingUnitBalancePresentation {
  const unavailable = unavailableUnitBalance(COMPUTE_UNIT_COPY, query, Boolean(plan));
  if (unavailable) {
    return unavailable;
  }
  if (!plan) {
    throw new Error("Compute balance requires billing plan data.");
  }

  const visibleGrants = (plan.grantAllocations ?? []).filter((grant) =>
    grant.active || grant.consumedSeconds > 0 || grant.remainingSeconds > 0
  );
  if (visibleGrants.length > 0) {
    const purchased = visibleGrants.reduce(
      (total, grant) => total + secondsToCredits(grant.totalSeconds),
      0,
    );
    const available = visibleGrants.reduce(
      (total, grant) => total + secondsToCredits(grant.remainingSeconds),
      0,
    );
    const used = visibleGrants.reduce(
      (total, grant) => total + secondsToCredits(grant.consumedSeconds),
      0,
    );
    return {
      ...COMPUTE_UNIT_COPY,
      purchased: formatCredits(purchased),
      available: formatCredits(available),
      used: formatCredits(used),
      availablePercent: purchased > 0 ? Math.round((available / purchased) * 100) : null,
      state: "ready",
    };
  }

  const available = plan.proBillingEnabled && plan.isPaidCloud
    ? plan.remainingManagedCloudHours
    : plan.remainingSandboxHours;
  const purchased = plan.proBillingEnabled && plan.isPaidCloud
    ? plan.includedManagedCloudHours
    : plan.freeSandboxHours;
  const used = plan.proBillingEnabled && plan.isPaidCloud
    ? purchased !== null && purchased !== undefined
      && available !== null && available !== undefined
      ? Math.max(purchased - available, 0)
      : null
    : plan.usedSandboxHours;

  return {
    ...COMPUTE_UNIT_COPY,
    purchased: formatCredits(purchased),
    available: formatCredits(available),
    used: formatCredits(used),
    availablePercent: purchased && purchased > 0 && available !== null && available !== undefined
      ? Math.round((available / purchased) * 100)
      : null,
    state: "ready",
  };
}

interface BillingUnitQueryState {
  enabled: boolean;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
}

function unavailableUnitBalance(
  copy: typeof COMPUTE_UNIT_COPY | typeof LLM_UNIT_COPY,
  query: BillingUnitQueryState,
  hasData: boolean,
): BillingUnitBalancePresentation | null {
  if (hasData) {
    return null;
  }
  if (!query.enabled) {
    return {
      ...copy,
      purchased: "",
      available: "",
      used: "",
      availablePercent: null,
      state: "unavailable",
      stateMessage: `${copy.title} are unavailable for this deployment.`,
    };
  }
  if (query.loading) {
    return {
      ...copy,
      purchased: "",
      available: "",
      used: "",
      availablePercent: null,
      state: "loading",
    };
  }
  if (query.error) {
    return {
      ...copy,
      purchased: "",
      available: "",
      used: "",
      availablePercent: null,
      state: "error",
      stateMessage: `Could not load ${copy.kind === "llm" ? "LLM credits" : "compute units"}.`,
      onRetry: query.onRetry,
    };
  }
  return {
    ...copy,
    purchased: "",
    available: "",
    used: "",
    availablePercent: null,
    state: "unavailable",
    stateMessage: `${copy.title} were not returned for this account.`,
  };
}

function secondsToCredits(seconds: number | null | undefined): number {
  return Math.max(seconds ?? 0, 0) / 3600;
}

function formatUsd(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "Unlimited";
  }
  return `$${Math.max(value, 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatCredits(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "Unlimited";
  }
  const rounded = Math.round(Math.max(value, 0) * 10) / 10;
  const formatted = rounded.toLocaleString(undefined, {
    maximumFractionDigits: Number.isInteger(rounded) ? 0 : 1,
  });
  return `${formatted} ${rounded === 1 ? "PCU" : "PCUs"}`;
}
