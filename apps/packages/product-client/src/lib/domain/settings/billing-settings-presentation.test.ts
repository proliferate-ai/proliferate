import { describe, expect, it, vi } from "vitest";
import type { BillingPlanInfo } from "@proliferate/cloud-sdk/types";
import {
  billingUnitBalances,
  planKeyForBilling,
  planSummary,
} from "#product/lib/domain/settings/billing-settings-presentation";

function billingPlan(overrides: Partial<BillingPlanInfo> = {}): BillingPlanInfo {
  return {
    plan: "free",
    billingMode: "enforce",
    proBillingEnabled: false,
    isUnlimited: false,
    hasUnlimitedCloudHours: false,
    overQuota: false,
    freeSandboxHours: 5,
    usedSandboxHours: 1,
    remainingSandboxHours: 4,
    cloudRepoLimit: 3,
    activeCloudRepoCount: 1,
    concurrentSandboxLimit: 1,
    activeSandboxCount: 0,
    isPaidCloud: false,
    paymentHealthy: true,
    overageEnabled: false,
    hostedInvoiceUrl: null,
    startBlocked: false,
    startBlockReason: null,
    activeSpendHold: false,
    billableSeatCount: 1,
    includedManagedCloudHours: null,
    remainingManagedCloudHours: null,
    managedCloudOverageEnabled: false,
    managedCloudOverageCapCents: null,
    managedCloudOverageUsedCents: 0,
    overagePricePerHourCents: 100,
    activeEnvironmentLimit: null,
    repoEnvironmentLimit: 3,
    byoRuntimeAllowed: false,
    legacyCloudSubscription: false,
    grantAllocations: [],
    ...overrides,
  };
}

describe("billing settings presentation", () => {
  it("projects the plan key and backend status without fabricated defaults", () => {
    expect(planKeyForBilling(null)).toBeNull();
    expect(planKeyForBilling(billingPlan())).toBe("free");
    expect(planKeyForBilling(billingPlan({ isPaidCloud: true }))).toBe("core");
    expect(planKeyForBilling(billingPlan({ isUnlimited: true }))).toBe("enterprise");

    expect(planSummary("core", billingPlan({
      isPaidCloud: true,
      paymentHealthy: false,
    }))).toMatchObject({
      name: "Core plan",
      price: "$20/month",
      badge: "Payment issue",
      badgeTone: "destructive",
    });
    expect(planSummary("core", billingPlan({
      isPaidCloud: true,
      paymentHealthy: false,
      startBlocked: true,
    }))).toMatchObject({ badge: "Paused", badgeTone: "warning" });
  });

  it("counts only active compute grants and returns the LLM balance independently", () => {
    const balances = billingUnitBalances({
      plan: billingPlan({
        isPaidCloud: true,
        grantAllocations: [
          {
            grantType: "expired",
            totalSeconds: 20 * 3600,
            consumedSeconds: 0,
            remainingSeconds: 20 * 3600,
            active: false,
          },
          {
            grantType: "active",
            totalSeconds: 10 * 3600,
            consumedSeconds: 6 * 3600,
            remainingSeconds: 4 * 3600,
            active: true,
          },
        ],
      }),
      planLoading: false,
      planError: false,
      onRetryPlan: vi.fn(),
      llmBalance: { grantedUsd: 100, usedUsd: 25, remainingUsd: 75 },
      llmBalanceLoading: false,
      llmBalanceError: false,
      onRetryLlmBalance: vi.fn(),
      enabled: true,
    });

    expect(balances[0]).toMatchObject({
      purchased: "10 PCUs",
      available: "4 PCUs",
      used: "6 PCUs",
      availablePercent: 40,
      state: "ready",
    });
    expect(balances[1]).toMatchObject({
      purchased: "$100.00",
      available: "$75.00",
      used: "$25.00",
      availablePercent: 75,
      state: "ready",
    });
  });

  it("keeps loading, error, and deployment-unavailable states explicit", () => {
    const retryPlan = vi.fn();
    const balances = billingUnitBalances({
      plan: undefined,
      planLoading: false,
      planError: true,
      onRetryPlan: retryPlan,
      llmBalance: undefined,
      llmBalanceLoading: true,
      llmBalanceError: false,
      onRetryLlmBalance: vi.fn(),
      enabled: true,
    });

    expect(balances[0]).toMatchObject({
      state: "error",
      stateMessage: "Could not load compute units.",
      onRetry: retryPlan,
    });
    expect(balances[1]).toMatchObject({ state: "loading" });

    const disabled = billingUnitBalances({
      plan: undefined,
      planLoading: false,
      planError: false,
      onRetryPlan: vi.fn(),
      llmBalance: undefined,
      llmBalanceLoading: false,
      llmBalanceError: false,
      onRetryLlmBalance: vi.fn(),
      enabled: false,
    });
    expect(disabled.map((balance) => balance.state)).toEqual([
      "unavailable",
      "unavailable",
    ]);
  });
});
