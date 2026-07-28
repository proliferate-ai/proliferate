import { BillingOwnerCard } from "@proliferate/ui";

const noop = () => {};
const hours = (value: number) => value * 3600;

const CORE_PLAN = {
  plan: "core",
  billingMode: "enforce",
  proBillingEnabled: true,
  isUnlimited: false,
  hasUnlimitedCloudHours: false,
  cloudRepoLimit: null,
  activeCloudRepoCount: 6,
  concurrentSandboxLimit: 8,
  activeSandboxCount: 3,
  isPaidCloud: true,
  paymentHealthy: true,
  overageEnabled: true,
  hostedInvoiceUrl: null,
  startBlocked: false,
  startBlockReason: null,
  activeSpendHold: false,
  billableSeatCount: 4,
  includedManagedCloudHours: 120,
  remainingManagedCloudHours: 46.5,
  managedCloudOverageEnabled: true,
  managedCloudOverageCapCents: 20_000,
  managedCloudOverageUsedCents: 4_350,
  overagePricePerHourCents: 350,
  repoEnvironmentLimit: 25,
  legacyCloudSubscription: false,
  grantAllocations: null,
};

const FREE_PLAN = {
  plan: "free",
  billingMode: "observe",
  proBillingEnabled: false,
  isUnlimited: false,
  hasUnlimitedCloudHours: false,
  freeSandboxHours: 10,
  usedSandboxHours: 6.25,
  remainingSandboxHours: 3.75,
  cloudRepoLimit: 3,
  activeCloudRepoCount: 2,
  concurrentSandboxLimit: 1,
  activeSandboxCount: 0,
  isPaidCloud: false,
  overageEnabled: false,
  startBlocked: false,
  activeSpendHold: false,
  legacyCloudSubscription: false,
  managedCloudOverageEnabled: false,
  grantAllocations: null,
};

export const CorePlan = () => (
  <div className="w-full max-w-3xl">
    <BillingOwnerCard
      view={{
        title: "Proliferate, Inc.",
        description: "Organization billing for 4 seats. Cloud work bills against the Core period grant.",
        iconKind: "organization",
        plan: CORE_PLAN,
        manageAction: { label: "Manage billing", onClick: noop },
        refillAction: { label: "Top up credits", onClick: noop },
      }}
    />
  </div>
);

export const FreePlan = () => (
  <div className="w-full max-w-3xl">
    <BillingOwnerCard
      view={{
        title: "Personal account",
        description: "Free cloud credits refresh monthly. Upgrade to Core for concurrent sandboxes.",
        iconKind: "personal",
        plan: FREE_PLAN,
        upgradeAction: { label: "Upgrade to Core", onClick: noop },
      }}
    />
  </div>
);

export const WithGrantBreakdown = () => (
  <div className="w-full max-w-3xl">
    <BillingOwnerCard
      view={{
        title: "Proliferate, Inc.",
        iconKind: "organization",
        plan: {
          ...CORE_PLAN,
          grantAllocations: [
            {
              grantType: "pro_period",
              totalSeconds: hours(120),
              consumedSeconds: hours(73.5),
              remainingSeconds: hours(46.5),
              active: true,
            },
            {
              grantType: "refill_10h",
              totalSeconds: hours(10),
              consumedSeconds: hours(2.25),
              remainingSeconds: hours(7.75),
              active: true,
            },
          ],
        },
        manageAction: { label: "Manage billing", onClick: noop },
      }}
    />
  </div>
);

/**
 * Credits exhausted with top-up off. The start-block Notice this state also
 * renders uses `tone="warning"`, whose ink token is an alpha FILL value — see
 * `.design-sync/learnings/F.md`. `billingMode: "observe"` keeps that unreadable
 * notice out of the sheet while still showing the exhausted balance, the
 * saturated usage bar and the destructive action error.
 */
export const CreditsExhausted = () => (
  <div className="w-full max-w-3xl">
    <BillingOwnerCard
      view={{
        title: "Proliferate, Inc.",
        iconKind: "organization",
        plan: {
          ...CORE_PLAN,
          billingMode: "observe",
          remainingManagedCloudHours: 0,
          managedCloudOverageEnabled: false,
          managedCloudOverageUsedCents: 20_000,
        },
        actionError: "Stripe checkout could not start. Try again in a minute.",
        refillAction: { label: "Top up credits", onClick: noop },
        manageAction: { label: "Manage billing", onClick: noop },
      }}
    />
  </div>
);

export const LoadFailed = () => (
  <div className="w-full max-w-3xl">
    <BillingOwnerCard
      view={{
        title: "Personal account",
        error: "Could not load the billing plan from Proliferate Cloud.",
        retryAction: { label: "Retry", onClick: noop },
      }}
    />
  </div>
);
