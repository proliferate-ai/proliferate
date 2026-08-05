import { describe, expect, it } from "vitest";

import { proliferateCreditBalance } from "./billing-presentation";
import type { BillingPlanView } from "./billing-plan";

function billingPlan(overrides: Partial<BillingPlanView> = {}): BillingPlanView {
  return {
    plan: "free",
    billingMode: "enforce",
    proBillingEnabled: false,
    isUnlimited: false,
    hasUnlimitedCloudHours: false,
    freeSandboxHours: 5,
    usedSandboxHours: 1,
    remainingSandboxHours: 4,
    cloudRepoLimit: 3,
    activeCloudRepoCount: 1,
    concurrentSandboxLimit: 1,
    activeSandboxCount: 0,
    isPaidCloud: false,
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
    managedCloudOverageUsedCents: null,
    overagePricePerHourCents: 100,
    repoEnvironmentLimit: 3,
    legacyCloudSubscription: false,
    grantAllocations: [],
    ...overrides,
  };
}

describe("proliferateCreditBalance", () => {
  it("shows zero used credits when usage data is absent", () => {
    expect(
      proliferateCreditBalance(billingPlan({
        usedSandboxHours: null,
        remainingSandboxHours: 5,
      })).used,
    ).toBe("0 PCUs");
  });

  it("does not present an expired grant's stored remainder as available", () => {
    expect(
      proliferateCreditBalance(billingPlan({
        proBillingEnabled: true,
        isPaidCloud: true,
        grantAllocations: [
          {
            grantType: "pro_period",
            totalSeconds: 20 * 3600,
            consumedSeconds: 0,
            remainingSeconds: 20 * 3600,
            active: false,
          },
          {
            grantType: "pro_period",
            totalSeconds: 20 * 3600,
            consumedSeconds: 20 * 3600,
            remainingSeconds: 0,
            active: true,
          },
        ],
      })),
    ).toEqual({
      purchased: "20 PCUs",
      available: "0 PCUs",
      used: "20 PCUs",
    });
  });
});
