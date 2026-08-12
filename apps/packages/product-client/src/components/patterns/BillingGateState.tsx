/**
 * Billing gate states: what the user sees when spend is blocked or running
 * low, with the one action that actually repairs it (billing.md T2: out of
 * credit at spend time is typed and actionable on every surface — never raw
 * provider noise).
 *
 * Two render modes:
 *  - `BillingGateState` — full panel for blocked screens (workspace start
 *    refused with a 402, LLM key disabled). Centered, flat, no card —
 *    the SettingsEmptyState anatomy with a tone-colored icon.
 *  - `BillingBalanceNotice` — inline banner for low-but-not-blocked
 *    balances (sidebar consumption card, billing pane).
 *
 * The view type and the `billingGateView` mapping from the server's typed
 * start-block reasons to it live beside their type at
 * `#product/lib/domain/billing/billing-gate-presentation` (component-hierarchy
 * re-audit: a locally declared view type relocates there, and the presenter
 * moves with it) — surfaces feed it the reason and their navigation actions
 * rather than re-deriving copy per callsite.
 */
import type { ReactNode } from "react";
import { twMerge } from "#product/primitives/utils/tw-merge";
import { Button } from "#product/primitives/Button";
import { CreditCard, Building2 } from "#product/primitives/icons/platform";
import { Zap } from "#product/primitives/icons/product";
import { CircleAlert } from "#product/primitives/icons/status";
import type { BillingGateKind, BillingGateStateView } from "#product/lib/domain/billing/billing-gate-presentation";

const GATE_ICON: Record<BillingGateKind, ReactNode> = {
  upgrade: <Zap className="icon-paired" />,
  refill: <Zap className="icon-paired" />,
  payment: <CreditCard className="icon-paired" />,
  admin: <Building2 className="icon-paired" />,
  limit: <CircleAlert className="icon-paired" />,
};

export function BillingGateState({
  view,
  size = "full",
  className,
}: {
  view: BillingGateStateView;
  /** Compact gates sit inside a pane; full-height states fill a screen. */
  size?: "compact" | "full";
  className?: string;
}) {
  return (
    <div
      role="status"
      className={twMerge(
        "flex flex-col items-center justify-center gap-2 text-center",
        size === "full" ? "min-h-[280px] px-6 py-16" : "py-8",
        className,
      )}
    >
      <div className="mb-1 flex items-center justify-center text-warning-foreground [&>svg]:icon-paired">
        {GATE_ICON[view.kind]}
      </div>
      <div className="text-ui font-medium leading-5 text-foreground">{view.title}</div>
      <div className="max-w-[48ch] text-ui-sm text-muted-foreground">{view.description}</div>
      {view.primaryAction || view.secondaryAction ? (
        <div className="mt-2 flex items-center gap-2">
          {view.primaryAction ? (
            <Button
              type="button"
              variant="primary"
              loading={view.primaryAction.loading}
              disabled={view.primaryAction.disabled}
              onClick={view.primaryAction.onClick}
            >
              {view.primaryAction.label}
            </Button>
          ) : null}
          {view.secondaryAction ? (
            <Button
              type="button"
              variant="outline"
              loading={view.secondaryAction.loading}
              disabled={view.secondaryAction.disabled}
              onClick={view.secondaryAction.onClick}
            >
              {view.secondaryAction.label}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function BillingBalanceNotice({
  view,
  tone = "warning",
  errorMessage,
  className,
}: {
  view: BillingGateStateView;
  tone?: "warning" | "destructive";
  /** Failure of the notice's own repair action; renders next to the action that caused it. */
  errorMessage?: string | null;
  className?: string;
}) {
  return (
    <div
      role="status"
      className={twMerge(
        "flex items-start gap-3 rounded-lg border p-3 text-body",
        tone === "destructive"
          ? "border-destructive/30 bg-destructive/10 text-destructive"
          : "border-warning-border bg-warning-subtle text-warning-foreground",
        className,
      )}
    >
      <span className="mt-0.5 shrink-0 [&>svg]:icon-paired">{GATE_ICON[view.kind]}</span>
      <div className="min-w-0 flex-1">
        <div className="font-medium">{view.title}</div>
        <div className="mt-0.5 leading-5 opacity-90">{view.description}</div>
        {errorMessage ? (
          <div className="mt-1 leading-5 text-destructive">{errorMessage}</div>
        ) : null}
      </div>
      {view.primaryAction ? (
        <Button
          type="button"
          variant="outline"
          className="ml-auto shrink-0"
          loading={view.primaryAction.loading}
          disabled={view.primaryAction.disabled}
          onClick={view.primaryAction.onClick}
        >
          {view.primaryAction.label}
        </Button>
      ) : null}
    </div>
  );
}
