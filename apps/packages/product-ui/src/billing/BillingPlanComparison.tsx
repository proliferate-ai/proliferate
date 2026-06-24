import { Check, CheckCircle2 } from "lucide-react";

import { Badge } from "@proliferate/ui/primitives/Badge";
import { Button } from "@proliferate/ui/primitives/Button";

import { SettingsCard } from "../settings/SettingsCard";
import type { BillingActionView } from "./billing-types";
import {
  BILLING_PLAN_COLUMNS,
  BILLING_PLAN_SECTIONS,
  type BillingPlanCell,
  type BillingPlanColumn,
  type BillingPlanSection,
} from "./billing-plan-ladder";
import { BillingButton, Notice } from "./BillingUiParts";

export function PlanComparisonCard({
  action,
  enterpriseAction,
  currentPlanKey,
}: {
  action?: BillingActionView;
  enterpriseAction?: BillingActionView;
  currentPlanKey: BillingPlanColumn["key"] | null;
}) {
  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold text-foreground">Plans</h2>
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
            Start free with 5 PCUs. Move to Core for monthly organization credits,
            unlimited members, top up, and role-based controls.
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
            action={plan.key === "core"
              ? action
              : plan.key === "enterprise"
                ? enterpriseAction
                : undefined}
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

export function CheckoutReturnNotice({ state }: { state: "success" | "cancel" }) {
  if (state === "success") {
    return (
      <div className="rounded-lg border border-success/40 bg-success/10 p-4 text-foreground">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
          <div className="min-w-0">
            <div className="text-sm font-medium">Stripe checkout completed</div>
            <p className="mt-1 text-sm leading-5 text-muted-foreground">
              Billing is refreshing from Stripe. The relevant card will update automatically
              as soon as the webhook lands.
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
      description="No plan change was made. You can restart checkout from the Core plan card."
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
