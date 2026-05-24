import type { ReactNode } from "react";
import {
  AlertTriangle,
  Building2,
  Check,
  CheckCircle2,
  Cloud,
  CreditCard,
  Gauge,
  Server,
} from "lucide-react";

import { Badge } from "@proliferate/ui/primitives/Badge";
import { Button } from "@proliferate/ui/primitives/Button";

import { SettingsCard } from "../settings/SettingsCard";
import { SettingsCardRow } from "../settings/SettingsCardRow";
import {
  BILLING_PLAN_COLUMNS,
  BILLING_PLAN_SECTIONS,
  type BillingPlanCell,
  type BillingPlanColumn,
  type BillingPlanSection,
} from "./billing-plan-ladder";

export interface BillingPlanView {
  plan?: string | null;
  billingMode: string;
  proBillingEnabled: boolean;
  isUnlimited: boolean;
  hasUnlimitedCloudHours: boolean;
  freeSandboxHours?: number | null;
  usedSandboxHours?: number | null;
  remainingSandboxHours?: number | null;
  cloudRepoLimit?: number | null;
  activeCloudRepoCount: number;
  concurrentSandboxLimit?: number | null;
  activeSandboxCount: number;
  isPaidCloud: boolean;
  overageEnabled: boolean;
  hostedInvoiceUrl?: string | null;
  startBlocked: boolean;
  startBlockReason?: string | null;
  activeSpendHold: boolean;
  billableSeatCount?: number | null;
  includedManagedCloudHours?: number | null;
  remainingManagedCloudHours?: number | null;
  managedCloudOverageEnabled: boolean;
  managedCloudOverageCapCents?: number | null;
  managedCloudOverageUsedCents?: number | null;
  overagePricePerHourCents?: number | null;
  repoEnvironmentLimit?: number | null;
  legacyCloudSubscription: boolean;
}

export interface BillingActionView {
  label: string;
  loading?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

export interface BillingOwnerCardView {
  title: string;
  description?: ReactNode;
  iconKind?: "personal" | "organization";
  plan?: BillingPlanView | null;
  loading?: boolean;
  error?: ReactNode;
  actionError?: ReactNode;
  retryAction?: BillingActionView;
  manageAction?: BillingActionView;
  upgradeAction?: BillingActionView;
  overageAction?: BillingActionView;
  invoiceAction?: BillingActionView;
}

export interface BillingSettingsPaneProps {
  children: ReactNode;
  planComparisonAction?: BillingActionView;
  currentPlanKey?: BillingPlanColumn["key"] | null;
  checkoutReturnState?: "success" | "cancel" | null;
}

export function BillingSettingsPane({
  children,
  planComparisonAction,
  currentPlanKey,
  checkoutReturnState,
}: BillingSettingsPaneProps) {
  return (
    <div className="space-y-6">
      {checkoutReturnState ? <CheckoutReturnNotice state={checkoutReturnState} /> : null}
      <PlanComparisonCard action={planComparisonAction} currentPlanKey={currentPlanKey ?? null} />
      {children}
    </div>
  );
}

export function BillingOwnerCard({ view }: { view: BillingOwnerCardView }) {
  const { plan } = view;

  if (view.loading && !plan) {
    return (
      <SettingsCard>
        <SettingsCardRow label={view.title} description="Loading billing state..." />
      </SettingsCard>
    );
  }

  if (view.error) {
    return (
      <SettingsCard>
        <SettingsCardRow label={view.title} description={view.error}>
          {view.retryAction ? <BillingButton action={view.retryAction} variant="secondary" /> : null}
        </SettingsCardRow>
      </SettingsCard>
    );
  }

  if (!plan) {
    return (
      <SettingsCard>
        <SettingsCardRow label={view.title} description="Billing details are not available." />
      </SettingsCard>
    );
  }

  const usage = runtimeUsage(plan);
  const status = planStatus(plan);
  const overage = overageSummary(plan);
  const Icon = view.iconKind === "organization" ? Building2 : CreditCard;

  return (
    <SettingsCard>
      <div className="space-y-5 p-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border-light bg-foreground/5 text-muted-foreground">
              <Icon className="size-4" />
            </div>
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-medium text-foreground">{view.title}</h2>
                <Badge tone={status.tone}>{status.label}</Badge>
              </div>
              {view.description ? (
                <p className="max-w-xl text-sm leading-6 text-muted-foreground">
                  {view.description}
                </p>
              ) : null}
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {plan.isPaidCloud && view.manageAction ? (
              <BillingButton action={view.manageAction} variant="outline" />
            ) : !plan.isPaidCloud && view.upgradeAction ? (
              <BillingButton action={view.upgradeAction} variant="primary" />
            ) : null}
          </div>
        </div>

        {view.actionError ? (
          <Notice tone="destructive" title="Billing action failed" description={view.actionError} />
        ) : null}

        {plan.billingMode === "enforce" && plan.startBlocked ? (
          <Notice
            tone="warning"
            title={startBlockTitle(plan.startBlockReason)}
            description={startBlockDescription(plan.startBlockReason)}
          />
        ) : null}

        <div className="space-y-3 border-t border-border-light pt-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Metric
              icon={<Gauge className="size-4" />}
              label={usage.label}
              value={usage.primary}
              detail={usage.detail}
            />
            <Metric
              icon={<Server className="size-4" />}
              label="Active sandboxes"
              value={formatLimit(plan.activeSandboxCount, plan.concurrentSandboxLimit)}
              detail="Currently running cloud work"
            />
            <Metric
              icon={<Cloud className="size-4" />}
              label="Cloud repos"
              value={formatLimit(plan.activeCloudRepoCount, repoLimit(plan))}
              detail="Enabled environments"
            />
          </div>

          {usage.percent !== null ? (
            <div className="space-y-1.5">
              <div className="h-1.5 overflow-hidden rounded-full bg-foreground/10">
                <div
                  className="h-full rounded-full bg-foreground"
                  style={{ width: `${usage.percent}%` }}
                />
              </div>
              <div className="text-xs text-muted-foreground">{usage.progressLabel}</div>
            </div>
          ) : null}
        </div>

        {overage ? (
          <div className="flex flex-col gap-3 border-t border-border-light pt-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 space-y-1">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                {overage.title}
                <Badge tone={overage.enabled ? "success" : "neutral"}>
                  {overage.enabled ? "On" : "Off"}
                </Badge>
              </div>
              <p className="text-xs leading-5 text-muted-foreground">{overage.description}</p>
            </div>
            {view.overageAction ? (
              <BillingButton action={view.overageAction} variant="secondary" />
            ) : null}
          </div>
        ) : null}

        {plan.hostedInvoiceUrl && plan.activeSpendHold ? (
          <Notice
            tone="warning"
            title="Payment needs attention"
            description="Cloud usage is paused until the open invoice is resolved."
            action={view.invoiceAction}
          />
        ) : null}
      </div>
    </SettingsCard>
  );
}

function PlanComparisonCard({
  action,
  currentPlanKey,
}: {
  action?: BillingActionView;
  currentPlanKey: BillingPlanColumn["key"] | null;
}) {
  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold text-foreground">Plans</h2>
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
            Start with Account credits. Start a Team plan when you need shared cloud,
            Slack-driven sessions, pooled runtime, and admin controls.
          </p>
        </div>
        {action ? (
          <BillingButton action={action} variant="primary" className="w-full sm:w-auto" />
        ) : null}
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        {BILLING_PLAN_COLUMNS.map((plan) => (
          <PlanSummaryCard
            key={plan.key}
            plan={plan}
            action={plan.key === "team" ? action : undefined}
            current={currentPlanKey === plan.key}
          />
        ))}
      </div>

      <SettingsCard>
        <div className="overflow-x-auto">
          <div className="min-w-[680px]">
            <div className="grid grid-cols-[minmax(11rem,1.35fr)_repeat(3,minmax(9rem,1fr))]">
              <div className="border-b border-border-light p-4" aria-hidden />
              {BILLING_PLAN_COLUMNS.map((plan) => (
                <PlanHeader
                  key={plan.key}
                  plan={plan}
                />
              ))}

              {BILLING_PLAN_SECTIONS.map((section) => (
                <PlanSectionRows key={section.title} section={section} />
              ))}
            </div>
          </div>
        </div>
      </SettingsCard>
    </section>
  );
}

function PlanSummaryCard({
  plan,
  action,
  current,
}: {
  plan: BillingPlanColumn;
  action?: BillingActionView;
  current: boolean;
}) {
  return (
    <SettingsCard
      className={
        current
          ? "border-info/50 bg-info/10"
          : plan.featured
            ? "border-border-heavy bg-foreground/[0.04]"
            : ""
      }
    >
      <div className="flex h-full flex-col gap-5 p-4">
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-medium text-foreground">{plan.name}</div>
              <div className="mt-1 text-xs leading-5 text-muted-foreground">{plan.tagline}</div>
            </div>
            {current ? <Badge tone="success">Current</Badge> : plan.featured ? <Badge tone="info">Popular</Badge> : null}
          </div>
          <div>
            <div className="text-3xl font-semibold text-foreground">{plan.price}</div>
            <div className="mt-1 text-xs text-muted-foreground">{plan.suffix}</div>
            <div className="mt-1 text-xs text-muted-foreground">{plan.billing}</div>
          </div>
        </div>

        <div className="space-y-3 border-t border-border-light pt-4">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {plan.highlightsLabel}
          </div>
          <ul className="space-y-2">
            {plan.highlights.map((highlight) => (
              <li key={highlight} className="flex gap-2 text-xs leading-5 text-muted-foreground">
                <Check className="mt-0.5 size-3.5 shrink-0 text-foreground" />
                <span>{highlight}</span>
              </li>
            ))}
          </ul>
        </div>

        {current ? (
          <Button type="button" variant="secondary" disabled className="mt-auto w-full">
            Current plan
          </Button>
        ) : action ? (
          <BillingButton action={action} variant="primary" className="mt-auto w-full" />
        ) : (
          <div className="mt-auto h-8" aria-hidden />
        )}
      </div>
    </SettingsCard>
  );
}

function CheckoutReturnNotice({ state }: { state: "success" | "cancel" }) {
  if (state === "success") {
    return (
      <div className="rounded-lg border border-success/40 bg-success/10 p-4 text-foreground">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
          <div className="min-w-0">
            <div className="text-sm font-medium">Stripe checkout completed</div>
            <p className="mt-1 text-sm leading-5 text-muted-foreground">
              Billing is refreshing from Stripe. If the relevant billing card has not updated yet,
              wait a moment for the webhook to finish and refresh this page.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <Notice
      tone="warning"
      title="Stripe checkout canceled"
      description="No plan change was made. You can restart checkout from the Team plan card."
    />
  );
}

function PlanHeader({
  plan,
}: {
  plan: BillingPlanColumn;
}) {
  return (
    <div
      className={`flex flex-col border-b border-border-light p-4 ${
        plan.featured ? "bg-foreground/[0.03]" : ""
      }`}
    >
      <div className="text-sm font-medium text-foreground">{plan.name}</div>
      <div className="mt-1 text-xs leading-5 text-muted-foreground">{plan.tagline}</div>
      <div className="mt-4 text-2xl font-semibold text-foreground">{plan.price}</div>
      <div className="mt-1 text-xs text-muted-foreground">{plan.suffix}</div>
      <div className="mt-4 border-t border-border-light pt-3 text-xs text-muted-foreground">
        {plan.billing}
      </div>
    </div>
  );
}

function PlanSectionRows({ section }: { section: BillingPlanSection }) {
  return (
    <>
      <div className="col-span-4 border-b border-border-light px-4 pt-5 pb-2 text-sm font-medium text-foreground">
        {section.title}
      </div>
      {section.rows.map((row) => (
        <div key={row.label} className="contents">
          <div className="flex min-h-10 items-center gap-2 border-b border-border-light px-4 py-2.5 text-xs text-muted-foreground">
            <span>{row.label}</span>
            {row.pill ? <Badge tone="neutral">{row.pill}</Badge> : null}
          </div>
          {BILLING_PLAN_COLUMNS.map((plan) => (
            <div
              key={`${row.label}-${plan.key}`}
              className={`flex min-h-10 items-center justify-center border-b border-border-light px-3 py-2.5 text-center ${
                plan.featured ? "bg-foreground/[0.03]" : ""
              }`}
            >
              <PlanValue value={row.values[plan.key]} featured={Boolean(plan.featured)} />
            </div>
          ))}
        </div>
      ))}
    </>
  );
}

function PlanValue({
  value,
  featured,
}: {
  value: BillingPlanCell;
  featured: boolean;
}) {
  if (value === true) {
    return <Check className="size-4 text-foreground" aria-label="Included" />;
  }
  if (value === false) {
    return <span className="text-sm text-muted-foreground" aria-label="Not included">-</span>;
  }
  return (
    <span className={`text-xs leading-5 ${featured ? "font-medium text-foreground" : "text-muted-foreground"}`}>
      {value}
    </span>
  );
}

function BillingButton({
  action,
  variant,
  className,
}: {
  action: BillingActionView;
  variant: "primary" | "secondary" | "outline";
  className?: string;
}) {
  return (
    <Button
      type="button"
      variant={variant}
      loading={action.loading}
      disabled={action.disabled}
      onClick={action.onClick}
      className={className}
    >
      {action.label}
    </Button>
  );
}

function Metric({
  icon,
  label,
  value,
  detail,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="min-w-0 space-y-2">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <span className="text-muted-foreground">{icon}</span>
        <span>{label}</span>
      </div>
      <div className="truncate text-lg font-semibold text-foreground">{value}</div>
      <div className="text-xs leading-5 text-muted-foreground">{detail}</div>
    </div>
  );
}

function Notice({
  action,
  tone,
  title,
  description,
}: {
  action?: BillingActionView;
  tone: "warning" | "destructive";
  title: string;
  description: ReactNode;
}) {
  return (
    <div
      className={`flex gap-3 rounded-lg border p-3 text-sm ${
        tone === "destructive"
          ? "border-destructive/30 bg-destructive/10 text-destructive"
          : "border-warning/30 bg-warning/10 text-warning"
      }`}
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0">
        <div className="font-medium">{title}</div>
        <div className="mt-1 leading-5 opacity-90">{description}</div>
      </div>
      {action ? (
        <BillingButton action={action} variant="outline" className="ml-auto shrink-0" />
      ) : null}
    </div>
  );
}

function planStatus(plan: BillingPlanView): {
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

function runtimeUsage(plan: BillingPlanView): {
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
  const used = plan.usedSandboxHours ?? 0;
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

function overageSummary(plan: BillingPlanView): {
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
      title: "Cloud overage",
      enabled: plan.overageEnabled,
      description: "Allow additional cloud runtime after prepaid hours are exhausted.",
    };
  }
  return null;
}

function repoLimit(plan: BillingPlanView): number | null | undefined {
  return plan.proBillingEnabled ? plan.repoEnvironmentLimit : plan.cloudRepoLimit;
}

function formatLimit(value: number, limit: number | null | undefined): string {
  if (limit === null || limit === undefined) {
    return value.toLocaleString();
  }
  return `${value.toLocaleString()} / ${limit.toLocaleString()}`;
}

function formatHours(value: number | null | undefined): string {
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

function formatCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "No cap";
  }
  return `$${(Math.max(value, 0) / 100).toLocaleString(undefined, {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  })}`;
}

function startBlockTitle(reason: string | null | undefined): string {
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

function startBlockDescription(reason: string | null | undefined): string {
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
