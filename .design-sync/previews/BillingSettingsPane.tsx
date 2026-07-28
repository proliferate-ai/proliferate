import {
  BillingOwnerCard,
  BillingSettingsPane,
  Button,
  SettingsRow,
  SettingsSection,
} from "@proliferate/ui";

const noop = () => {};

const CORE_PLAN = {
  plan: "core",
  billingMode: "enforce",
  proBillingEnabled: true,
  isUnlimited: false,
  hasUnlimitedCloudHours: false,
  cloudRepoLimit: null,
  activeCloudRepoCount: 6,
  concurrentSandboxLimit: 8,
  activeSandboxCount: 2,
  isPaidCloud: true,
  paymentHealthy: true,
  overageEnabled: true,
  startBlocked: false,
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

const ManagementCards = () => (
  <SettingsSection
    title="Payment"
    description="Stripe holds the payment method and issues invoices for this organization."
  >
    <SettingsRow
      label="Payment method"
      description="Visa ending 4242 · expires 08/2029"
    >
      <Button type="button" variant="secondary" size="sm" onClick={noop}>
        Open Stripe portal
      </Button>
    </SettingsRow>
    <SettingsRow
      label="Auto top up"
      description="Buys another 10 PCUs whenever the balance drops below 5."
    >
      <Button type="button" variant="secondary" size="sm" onClick={noop}>
        Configure
      </Button>
    </SettingsRow>
  </SettingsSection>
);

export const PlanAndPayment = () => (
  <div className="w-full max-w-3xl">
    <BillingSettingsPane
      currentPlanKey="core"
      planComparisonAction={{ label: "Compare plans", onClick: noop }}
      enterprisePlanAction={{ label: "Talk to sales", onClick: noop }}
    >
      <BillingOwnerCard
        view={{
          title: "Proliferate, Inc.",
          iconKind: "organization",
          plan: CORE_PLAN,
          manageAction: { label: "Manage billing", onClick: noop },
        }}
      />
      <ManagementCards />
    </BillingSettingsPane>
  </div>
);

export const CheckoutSuccess = () => (
  <div className="w-full max-w-3xl">
    <BillingSettingsPane currentPlanKey="core" checkoutReturnState="success">
      <ManagementCards />
    </BillingSettingsPane>
  </div>
);

/**
 * The pane stacks whatever owner cards its host supplies — personal first,
 * then each organization the viewer can bill for.
 *
 * (`checkoutReturnState="cancel"` is the pane's fourth state. It renders a
 * `tone="warning"` Notice whose ink token is an alpha FILL value, so it
 * photographs as an empty box — see `.design-sync/learnings/F.md`. It is left
 * out of this sheet deliberately.)
 */
export const StackedOwnerCards = () => (
  <div className="w-full max-w-3xl">
    <BillingSettingsPane currentPlanKey="core">
      <BillingOwnerCard
        view={{
          title: "Personal account",
          iconKind: "personal",
          plan: {
            ...CORE_PLAN,
            isPaidCloud: false,
            proBillingEnabled: false,
            freeSandboxHours: 10,
            usedSandboxHours: 6.25,
            remainingSandboxHours: 3.75,
            cloudRepoLimit: 3,
            activeCloudRepoCount: 1,
            concurrentSandboxLimit: 1,
            activeSandboxCount: 0,
          },
          upgradeAction: { label: "Upgrade to Core", onClick: noop },
        }}
      />
      <BillingOwnerCard
        view={{
          title: "Proliferate, Inc.",
          iconKind: "organization",
          plan: { ...CORE_PLAN, isUnlimited: true },
          manageAction: { label: "Manage billing", onClick: noop },
        }}
      />
    </BillingSettingsPane>
  </div>
);

export const PlanManagementDialogOpen = () => (
  <div className="w-full max-w-3xl">
    <BillingSettingsPane
      currentPlanKey="free"
      planComparisonAction={{ label: "Upgrade to Core", onClick: noop }}
      enterprisePlanAction={{ label: "Talk to sales", onClick: noop }}
      planManagementDialog={{
        open: true,
        onClose: noop,
        currentPlanKey: "free",
        organizationName: "Proliferate, Inc.",
        portalAction: { label: "Open Stripe portal", onClick: noop },
        pricingAction: { label: "See full pricing", onClick: noop },
      }}
    >
      <ManagementCards />
    </BillingSettingsPane>
  </div>
);
