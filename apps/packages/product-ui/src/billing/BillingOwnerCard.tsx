import { Building2, Cloud, CreditCard, Gauge, Server } from "lucide-react";

import { Badge } from "@proliferate/ui/primitives/Badge";

import { SettingsCard } from "../settings/SettingsCard";
import { SettingsCardRow } from "../settings/SettingsCardRow";
import type { BillingOwnerCardView } from "./billing-types";
import { CreditGrantBreakdown } from "./BillingCreditGrantBreakdown";
import {
  formatLimit,
  overageSummary,
  planStatus,
  repoLimit,
  runtimeUsage,
  startBlockDescription,
  startBlockTitle,
} from "./billing-presentation";
import { BillingButton, Metric, Notice } from "./BillingUiParts";

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
            {view.refillAction ? <BillingButton action={view.refillAction} variant="secondary" /> : null}
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

        <CreditGrantBreakdown plan={plan} />

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
