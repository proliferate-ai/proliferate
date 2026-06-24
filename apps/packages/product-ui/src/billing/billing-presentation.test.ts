import { describe, expect, it } from "vitest";

import { proliferateCreditBalance } from "./billing-presentation";
import type { BillingPlanView } from "./billing-types";

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
});
