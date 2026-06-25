import { useEffect, useState } from "react";
import type { BillingReturnSurface } from "@proliferate/cloud-sdk";
import {
  useCloudBilling,
  useCloudBillingActions,
} from "@proliferate/cloud-sdk-react";
import {
  BillingSettingsPane,
  type BillingPlanView,
} from "@proliferate/product-ui/billing/BillingSettingsPane";
import { SettingsCard } from "@proliferate/product-ui/settings/SettingsCard";
import { SettingsPageHeader } from "@proliferate/product-ui/settings/SettingsPageHeader";
import { ExternalLink } from "@proliferate/ui/icons";
import { Badge } from "@proliferate/ui/primitives/Badge";
import { Button } from "@proliferate/ui/primitives/Button";
import { ProgressBar } from "@proliferate/ui/primitives/ProgressBar";
import { Select } from "@proliferate/ui/primitives/Select";
import { Switch } from "@proliferate/ui/primitives/Switch";

export type BillingCheckoutReturnState = "success" | "cancel" | null;

export interface BillingSettingsOrganization {
  id: string;
  name: string;
  canManageBilling: boolean;
  loading: boolean;
}

export interface BillingSettingsSurfaceProps {
  organization: BillingSettingsOrganization | null;
  organizationLoading?: boolean;
  enabled?: boolean;
  billingReturnSurface?: BillingReturnSurface;
  checkoutReturnState?: BillingCheckoutReturnState;
  onOpenUrl: (url: string) => void | Promise<void>;
  onOpenPricingPage?: () => void | Promise<void>;
  onOpenOrganizationSettings: () => void;
}

const COMPUTE_TOP_UP_OPTIONS = [
  { value: "40", label: "40 PCUs - $10.00" },
  { value: "100", label: "100 PCUs - $25.00" },
  { value: "200", label: "200 PCUs - $50.00" },
  { value: "500", label: "500 PCUs - $125.00" },
];

const LLM_TOP_UP_OPTIONS = [
  { value: "2500", label: "2,500 LLM credits - $25.00" },
  { value: "5000", label: "5,000 LLM credits - $50.00" },
  { value: "10000", label: "10,000 LLM credits - $100.00" },
  { value: "25000", label: "25,000 LLM credits - $250.00" },
];

const MOCK_COMPUTE_BALANCE: BillingUnitBalancePresentation = {
  kind: "compute",
  title: "Compute units",
  description: "Used by hosted runtime, sandboxes, and execution time.",
  purchased: "360 PCUs",
  available: "118 PCUs",
  used: "242 PCUs",
  availablePercent: 33,
  topUpLabel: "Add compute units",
  lowBalanceCopy: "Need more runtime capacity? Add compute units any time.",
  topUpOptions: COMPUTE_TOP_UP_OPTIONS,
};

const MOCK_LLM_BALANCE: BillingUnitBalancePresentation = {
  kind: "llm",
  title: "LLM credits",
  description: "Used by model gateway calls, inference-backed tools, and managed model access.",
  purchased: "12,000 LLM credits",
  available: "4,600 LLM credits",
  used: "7,400 LLM credits",
  availablePercent: 38,
  topUpLabel: "Add LLM credits",
  lowBalanceCopy: "Need more model usage? Add LLM credits any time.",
  topUpOptions: LLM_TOP_UP_OPTIONS,
};

export function BillingSettingsSurface({
  organization,
  organizationLoading = organization?.loading ?? false,
  enabled = true,
  billingReturnSurface = "web",
  checkoutReturnState = null,
  onOpenUrl,
  onOpenPricingPage,
  onOpenOrganizationSettings,
}: BillingSettingsSurfaceProps) {
  const billingReturnOptions = { returnSurface: billingReturnSurface };
  const comparisonOwner = organization?.canManageBilling
    ? { ownerScope: "organization" as const, organizationId: organization.id }
    : undefined;
  const comparisonBilling = useCloudBilling(comparisonOwner, enabled);
  const comparisonActions = useCloudBillingActions(comparisonOwner, billingReturnOptions);
  const [comparisonActionError, setComparisonActionError] = useState<string | null>(null);
  const [planManagementOpen, setPlanManagementOpen] = useState(false);
  const [computeTopUpAmount, setComputeTopUpAmount] = useState("100");
  const [llmTopUpAmount, setLlmTopUpAmount] = useState("5000");

  useEffect(() => {
    if (checkoutReturnState !== "success") {
      return;
    }
    void comparisonBilling.refetch();
  }, [checkoutReturnState, comparisonBilling.refetch]);

  function openPlanManagement() {
    setComparisonActionError(null);
    if (!organization) {
      onOpenOrganizationSettings();
      return;
    }
    if (!organization.canManageBilling) {
      setComparisonActionError("Organization billing is managed by owners and admins.");
      return;
    }
    setPlanManagementOpen(true);
  }

  async function openComparisonBillingAction(action: "checkout" | "portal" | "refill") {
    setComparisonActionError(null);
    try {
      const response = action === "portal"
        ? await comparisonActions.createBillingPortal()
        : action === "refill"
          ? await comparisonActions.createRefillCheckout()
          : await comparisonActions.createCloudCheckout();
      await onOpenUrl(response.url);
    } catch (error) {
      setComparisonActionError(
        error instanceof Error ? error.message : "Billing action could not start.",
      );
    }
  }

  async function updateComparisonTopUp(nextEnabled: boolean) {
    setComparisonActionError(null);
    try {
      await comparisonActions.updateOverageEnabled({ enabled: nextEnabled });
    } catch (error) {
      setComparisonActionError(
        error instanceof Error ? error.message : "Top up setting could not be updated.",
      );
    }
  }

  function openPricingPage() {
    if (!onOpenPricingPage) {
      return;
    }
    void onOpenPricingPage();
  }

  const billingPlan = comparisonBilling.data;
  const currentPlanKey = planKeyForBilling(billingPlan);
  const plan = planSummary(currentPlanKey, billingPlan);
  const unitBalances = billingUnitBalances(billingPlan);
  const topUpEnabled = Boolean(
    billingPlan?.managedCloudOverageEnabled || billingPlan?.overageEnabled,
  );
  const canManage = organization?.canManageBilling === true;
  const paidPlan = billingPlan?.isPaidCloud === true;
  const comparisonActionDisabled = !enabled
    || organizationLoading
    || (canManage ? comparisonBilling.isLoading : false);
  const billingActionDisabled = comparisonActionDisabled || !canManage || !paidPlan;
  const coreActionLoading = billingPlan?.isPaidCloud
    ? comparisonActions.creatingBillingPortal
    : comparisonActions.creatingCloudCheckout;

  return (
    <section className="max-w-[820px] space-y-6">
      <SettingsPageHeader
        title="Billing"
        description="Manage usage and billing details."
      />
      <BillingSettingsPane
        checkoutReturnState={checkoutReturnState}
        currentPlanKey={currentPlanKey}
        planComparisonAction={{
          label: !organization ? "Create organization" : "Manage plan",
          disabled: comparisonActionDisabled,
          onClick: openPlanManagement,
        }}
        enterprisePlanAction={onOpenPricingPage ? {
          label: "Request trial",
          onClick: openPricingPage,
        } : undefined}
        planManagementDialog={canManage && organization ? {
          open: planManagementOpen,
          onClose: () => {
            setPlanManagementOpen(false);
          },
          currentPlanKey,
          organizationName: organization.name,
          coreAction: {
            label: billingPlan?.isPaidCloud ? "Manage Core" : "Upgrade to Core",
            loading: coreActionLoading,
            disabled: comparisonActionDisabled,
            onClick: () => {
              void openComparisonBillingAction(
                billingPlan?.isPaidCloud ? "portal" : "checkout",
              );
            },
          },
          portalAction: billingPlan?.isPaidCloud
            ? {
                label: "Billing portal",
                loading: comparisonActions.creatingBillingPortal,
                disabled: comparisonActionDisabled,
                onClick: () => {
                  void openComparisonBillingAction("portal");
                },
              }
            : undefined,
          enterpriseAction: onOpenPricingPage ? {
            label: "Request trial",
            onClick: openPricingPage,
          } : undefined,
          pricingAction: onOpenPricingPage ? {
            label: "Learn more about pricing",
            onClick: openPricingPage,
          } : undefined,
          actionErrorMessage: comparisonActionError,
        } : undefined}
      >
        <BillingPlanCard
          plan={plan}
          organization={organization}
          organizationLoading={organizationLoading}
          loading={canManage ? comparisonBilling.isLoading : false}
          actionError={comparisonActionError}
          onManage={openPlanManagement}
        />

        <BillingUnitBalancesCard
          unitBalances={unitBalances}
          topUpAmounts={{
            compute: computeTopUpAmount,
            llm: llmTopUpAmount,
          }}
          addCreditsLoading={comparisonActions.creatingRefillCheckout}
          addCreditsDisabled={billingActionDisabled}
          onTopUpAmountChange={(kind, value) => {
            if (kind === "compute") {
              setComputeTopUpAmount(value);
              return;
            }
            setLlmTopUpAmount(value);
          }}
          onAddCredits={(_kind) => {
            void openComparisonBillingAction("refill");
          }}
        />

        <BillingAutoTopUpCard
          enabled={topUpEnabled}
          disabled={billingActionDisabled || comparisonActions.updatingOverage}
          saving={comparisonActions.updatingOverage}
          computeTopUpLabel={labelForTopUpOption(COMPUTE_TOP_UP_OPTIONS, computeTopUpAmount)}
          llmTopUpLabel={labelForTopUpOption(LLM_TOP_UP_OPTIONS, llmTopUpAmount)}
          onEnabledChange={(value) => {
            void updateComparisonTopUp(value);
          }}
        />

        <BillingPortalCard
          loading={comparisonActions.creatingBillingPortal}
          disabled={billingActionDisabled}
          onOpenPortal={() => {
            void openComparisonBillingAction("portal");
          }}
        />
      </BillingSettingsPane>
    </section>
  );
}

function BillingPlanCard({
  plan,
  organization,
  organizationLoading,
  loading,
  actionError,
  onManage,
}: {
  plan: BillingPlanPresentation;
  organization: BillingSettingsOrganization | null;
  organizationLoading: boolean;
  loading: boolean;
  actionError: string | null;
  onManage: () => void;
}) {
  return (
    <SettingsCard>
      <div className="space-y-4 p-5">
        <h2 className="text-lg font-semibold text-foreground">Plan</h2>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-base font-medium text-foreground">{plan.name}</span>
              <span className="text-base font-medium text-muted-foreground">· {plan.price}</span>
              <Badge tone={plan.badgeTone}>{plan.badge}</Badge>
            </div>
            <p className="text-sm leading-5 text-muted-foreground">
              {organizationLoading
                ? "Billing details for this organization."
                : organization
                  ? `Billing for ${organization.name}.`
                  : "Shared billing and credits for this workspace."}
            </p>
            {actionError ? <p className="text-sm text-destructive">{actionError}</p> : null}
          </div>
          <Button
            type="button"
            variant="primary"
            loading={loading}
            disabled={organizationLoading}
            onClick={onManage}
            className="w-full sm:w-auto"
          >
            Manage
          </Button>
        </div>
      </div>
    </SettingsCard>
  );
}

function BillingUnitBalancesCard({
  unitBalances,
  topUpAmounts,
  addCreditsLoading,
  addCreditsDisabled,
  onTopUpAmountChange,
  onAddCredits,
}: {
  unitBalances: BillingUnitBalancePresentation[];
  topUpAmounts: Record<BillingUnitKind, string>;
  addCreditsLoading: boolean;
  addCreditsDisabled: boolean;
  onTopUpAmountChange: (kind: BillingUnitKind, value: string) => void;
  onAddCredits: (kind: BillingUnitKind) => void;
}) {
  return (
    <SettingsCard>
      <div className="space-y-6 p-5">
        <div className="space-y-1.5">
          <h2 className="text-lg font-semibold text-foreground">Usage units</h2>
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
            Compute units and LLM credits are tracked, budgeted, and topped up separately.
          </p>
        </div>

        <div className="grid gap-4">
          {unitBalances.map((unitBalance) => (
            <BillingUnitPoolCard
              key={unitBalance.kind}
              unitBalance={unitBalance}
              topUpAmount={topUpAmounts[unitBalance.kind]}
              addCreditsLoading={addCreditsLoading}
              addCreditsDisabled={addCreditsDisabled}
              onTopUpAmountChange={(value) => onTopUpAmountChange(unitBalance.kind, value)}
              onAddCredits={() => onAddCredits(unitBalance.kind)}
            />
          ))}
        </div>
      </div>
    </SettingsCard>
  );
}

function BillingUnitPoolCard({
  unitBalance,
  topUpAmount,
  addCreditsLoading,
  addCreditsDisabled,
  onTopUpAmountChange,
  onAddCredits,
}: {
  unitBalance: BillingUnitBalancePresentation;
  topUpAmount: string;
  addCreditsLoading: boolean;
  addCreditsDisabled: boolean;
  onTopUpAmountChange: (value: string) => void;
  onAddCredits: () => void;
}) {
  const selectId = `billing-${unitBalance.kind}-top-up-amount`;

  return (
    <section className="overflow-hidden rounded-lg border border-border-light bg-foreground/[0.02]">
      <div className="space-y-5 p-4">
        <div className="space-y-1">
          <h3 className="text-base font-semibold text-foreground">{unitBalance.title}</h3>
          <p className="text-sm leading-5 text-muted-foreground">{unitBalance.description}</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <BillingMetric label="Total purchased" value={unitBalance.purchased} />
          <BillingMetric label="Available" value={unitBalance.available} />
          <BillingMetric label="Used" value={unitBalance.used} />
        </div>

        <ProgressBar
          value={unitBalance.availablePercent ?? 0}
          className="h-4 overflow-hidden rounded-full border border-border-light bg-foreground/5 p-0.5"
          indicatorClassName="h-full rounded-full bg-primary/70"
          aria-label={`${unitBalance.title} available`}
        />
      </div>

      <div className="border-t border-border-light bg-background/40 p-4">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <h4 className="text-sm font-medium text-foreground">
              Top up {unitBalance.title.toLowerCase()}
            </h4>
            <p className="mt-1 text-sm leading-5 text-muted-foreground">
              {unitBalance.lowBalanceCopy}
            </p>
          </div>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
          <div className="min-w-0 flex-1">
            <label className="sr-only" htmlFor={selectId}>
              {unitBalance.title} top-up amount
            </label>
            <Select
              id={selectId}
              value={topUpAmount}
              onChange={(event) => onTopUpAmountChange(event.currentTarget.value)}
              disabled={addCreditsDisabled}
            >
              {unitBalance.topUpOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </Select>
          </div>
          <Button
            type="button"
            variant="secondary"
            loading={addCreditsLoading}
            disabled={addCreditsDisabled}
            onClick={onAddCredits}
            className="w-full sm:w-auto"
          >
            {unitBalance.topUpLabel}
          </Button>
        </div>
      </div>
    </section>
  );
}

function BillingAutoTopUpCard({
  enabled,
  disabled,
  saving,
  computeTopUpLabel,
  llmTopUpLabel,
  onEnabledChange,
}: {
  enabled: boolean;
  disabled: boolean;
  saving: boolean;
  computeTopUpLabel: string;
  llmTopUpLabel: string;
  onEnabledChange: (value: boolean) => void;
}) {
  return (
    <SettingsCard>
      <div className="space-y-6 p-5">
        <div className="space-y-1.5">
          <h2 className="text-lg font-semibold text-foreground">Auto top-up</h2>
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
            Automatically replenish compute units and LLM credits from their own thresholds.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Switch
            checked={enabled}
            onChange={onEnabledChange}
            disabled={disabled}
            aria-label="Auto top-up"
          />
          <span className="text-sm font-medium text-foreground">Enable auto top-up</span>
          {saving ? <span className="text-xs text-muted-foreground">Saving...</span> : null}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <AutoTopUpSummary
            label="Compute auto top-up"
            description={`When compute units fall below 40 PCUs, add ${computeTopUpLabel}.`}
          />
          <AutoTopUpSummary
            label="LLM credit auto top-up"
            description={`When LLM credits fall below 2,000, add ${llmTopUpLabel}.`}
          />
        </div>

        <p className="text-sm text-muted-foreground">Last auto top-up: not yet run.</p>
      </div>
    </SettingsCard>
  );
}

function AutoTopUpSummary({ label, description }: { label: string; description: string }) {
  return (
    <div className="rounded-lg border border-border-light bg-foreground/[0.02] p-3">
      <div className="text-sm font-medium text-foreground">{label}</div>
      <div className="mt-1 text-sm leading-5 text-muted-foreground">{description}</div>
    </div>
  );
}

function BillingPortalCard({
  loading,
  disabled,
  onOpenPortal,
}: {
  loading: boolean;
  disabled: boolean;
  onOpenPortal: () => void;
}) {
  return (
    <SettingsCard>
      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 space-y-1.5">
          <h2 className="text-lg font-semibold text-foreground">Billing</h2>
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
            View invoices, update payment methods, and manage cancellation in Stripe.
          </p>
        </div>
        <Button
          type="button"
          variant="primary"
          loading={loading}
          disabled={disabled}
          onClick={onOpenPortal}
          className="w-full sm:w-auto"
        >
          Access billing portal
          <ExternalLink className="size-3.5" />
        </Button>
      </div>
    </SettingsCard>
  );
}

function BillingMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="mb-1 text-sm text-muted-foreground">{label}</p>
      <p className="break-words text-xl font-semibold leading-tight text-foreground sm:text-2xl">
        {value}
      </p>
    </div>
  );
}

type BillingPlanViewKey = "free" | "core" | "enterprise";

interface BillingPlanPresentation {
  name: string;
  price: string;
  badge: string;
  badgeTone: "neutral" | "success" | "info" | "warning" | "destructive";
}

function planKeyForBilling(plan: BillingPlanView | null | undefined): BillingPlanViewKey | null {
  if (!plan) {
    return null;
  }
  if (plan.isUnlimited && !plan.isPaidCloud) {
    return "enterprise";
  }
  return plan.isPaidCloud ? "core" : "free";
}

function planSummary(
  planKey: BillingPlanViewKey | null,
  plan: BillingPlanView | null | undefined,
): BillingPlanPresentation {
  if (!plan) {
    return {
      name: "Core plan",
      price: "$20/month",
      badge: "Mocked",
      badgeTone: "neutral",
    };
  }
  if (planKey === "enterprise") {
    return {
      name: "Enterprise plan",
      price: "custom",
      badge: "Active",
      badgeTone: "success",
    };
  }
  if (planKey === "core") {
    return {
      name: "Core plan",
      price: "$20/month",
      badge: "Active",
      badgeTone: "success",
    };
  }
  return {
    name: "Free plan",
    price: "$0/month",
    badge: "Active",
    badgeTone: "neutral",
  };
}

type BillingUnitKind = "compute" | "llm";

interface BillingTopUpOption {
  value: string;
  label: string;
}

interface BillingUnitBalancePresentation {
  kind: BillingUnitKind;
  title: string;
  description: string;
  purchased: string;
  available: string;
  used: string;
  availablePercent: number | null;
  topUpLabel: string;
  lowBalanceCopy: string;
  topUpOptions: BillingTopUpOption[];
}

function billingUnitBalances(
  plan: BillingPlanView | null | undefined,
): BillingUnitBalancePresentation[] {
  return [
    computeBalanceSummary(plan),
    MOCK_LLM_BALANCE,
  ];
}

function computeBalanceSummary(
  plan: BillingPlanView | null | undefined,
): BillingUnitBalancePresentation {
  if (!plan) {
    return MOCK_COMPUTE_BALANCE;
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
      ...MOCK_COMPUTE_BALANCE,
      purchased: formatCredits(purchased),
      available: formatCredits(available),
      used: formatCredits(used),
      availablePercent: purchased > 0 ? Math.round((available / purchased) * 100) : null,
    };
  }

  return MOCK_COMPUTE_BALANCE;
}

function secondsToCredits(seconds: number | null | undefined): number {
  return Math.max(seconds ?? 0, 0) / 3600;
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

function labelForTopUpOption(options: BillingTopUpOption[], value: string): string {
  return options.find((option) => option.value === value)?.label ?? options[0]?.label ?? value;
}
