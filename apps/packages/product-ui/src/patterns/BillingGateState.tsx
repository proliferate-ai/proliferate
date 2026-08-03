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
 * `billingGateView` is the single mapping from the server's typed
 * start-block reasons to a view; surfaces feed it the reason and their
 * navigation actions rather than re-deriving copy per callsite.
 */
import type { ReactNode } from "react";
import { twMerge } from "@proliferate/ui/utils/tw-merge";
import { Button } from "@proliferate/ui/primitives/Button";
import { CreditCard, Zap, CircleAlert, Building2 } from "@proliferate/ui/icons";

export type BillingGateKind = "upgrade" | "refill" | "payment" | "admin" | "limit";

export interface BillingGateAction {
  label: string;
  onClick: () => void;
  loading?: boolean;
  disabled?: boolean;
}

export interface BillingGateStateView {
  kind: BillingGateKind;
  title: string;
  description: string;
  /** The one action that repairs the state; absent when only an admin can act. */
  primaryAction?: BillingGateAction | null;
  /** Optional escape hatch (open billing settings, contact admin). */
  secondaryAction?: BillingGateAction | null;
}

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

/**
 * Typed gate reasons. The seven compute values are the server's start-block
 * kinds verbatim (`server/proliferate/constants/billing.py`, carried on
 * `BillingPlanInfo.startBlockReason`). The two `llm_*` values are UI-level:
 * the server's LLM vocabulary is `budget_status` `"exhausted"` /
 * `"limit_reached"` (`constants/agent_gateway.py`), so an LLM surface must
 * map that status here rather than passing it through. `unknown` renders
 * the generic blocked state rather than leaking a raw code.
 */
export type BillingGateReason =
  | "credits_exhausted"
  | "overage_disabled"
  | "cap_exhausted"
  | "payment_failed"
  | "external_billing_hold"
  | "admin_hold"
  | "concurrency_limit"
  | "llm_credits_exhausted"
  | "llm_limit_reached"
  | "unknown";

const BILLING_GATE_REASONS: ReadonlySet<string> = new Set([
  "credits_exhausted",
  "overage_disabled",
  "cap_exhausted",
  "payment_failed",
  "external_billing_hold",
  "admin_hold",
  "concurrency_limit",
  "llm_credits_exhausted",
  "llm_limit_reached",
]);

/** Server `startBlockReason` arrives untyped; unrecognized codes render the generic gate. */
export function toBillingGateReason(value: string | null | undefined): BillingGateReason {
  return value && BILLING_GATE_REASONS.has(value) ? (value as BillingGateReason) : "unknown";
}

export interface BillingGateViewOptions {
  /** Paid subjects refill; free subjects upgrade. */
  isPaidPlan: boolean;
  /** Whether the viewer can act on billing (org admin or personal owner). */
  canManageBilling: boolean;
  onUpgrade?: () => void;
  onRefill?: () => void;
  onOpenBilling?: () => void;
  actionLoading?: boolean;
  /** Disable repair actions while the surface's billing context is still settling. */
  actionDisabled?: boolean;
}

const ADMIN_MANAGED_DESCRIPTION =
  "An organization admin manages billing for this workspace.";

export function billingGateView(
  reason: BillingGateReason,
  opts: BillingGateViewOptions,
): BillingGateStateView {
  const openBilling: BillingGateAction | null = opts.onOpenBilling
    ? { label: "Billing settings", onClick: opts.onOpenBilling }
    : null;
  const upgrade: BillingGateAction | null = opts.onUpgrade
    ? {
        label: "Upgrade",
        onClick: opts.onUpgrade,
        loading: opts.actionLoading,
        disabled: opts.actionDisabled,
      }
    : null;
  const refill: BillingGateAction | null = opts.onRefill
    ? {
        label: "Add credits",
        onClick: opts.onRefill,
        loading: opts.actionLoading,
        disabled: opts.actionDisabled,
      }
    : null;
  const memberView = (title: string, description: string): BillingGateStateView => ({
    kind: "admin",
    title,
    description: `${description} ${ADMIN_MANAGED_DESCRIPTION}`,
    primaryAction: null,
    secondaryAction: null,
  });

  switch (reason) {
    case "credits_exhausted":
      if (!opts.canManageBilling) {
        return memberView("Out of credits", "This workspace's included credits are used up.");
      }
      return opts.isPaidPlan
        ? {
            kind: "refill",
            title: "Out of credits",
            description:
              "Your included credits for this period are used up. Add credits to keep working.",
            primaryAction: refill ?? openBilling,
            secondaryAction: refill ? openBilling : null,
          }
        : {
            kind: "upgrade",
            title: "Out of free credits",
            description:
              "You've used your free included credits. Upgrade to keep working in the cloud.",
            primaryAction: upgrade ?? openBilling,
            secondaryAction: upgrade ? openBilling : null,
          };
    case "overage_disabled":
      if (!opts.canManageBilling) {
        return memberView("Usage paused", "Included credits are used up and overage is off.");
      }
      return {
        kind: "refill",
        title: "Usage paused",
        description:
          "Included credits are used up and overage is turned off. Enable overage or add credits to continue.",
        primaryAction: openBilling,
        secondaryAction: null,
      };
    case "cap_exhausted":
      if (!opts.canManageBilling) {
        return memberView("Spending cap reached", "This period's spending cap has been reached.");
      }
      return {
        kind: "limit",
        title: "Spending cap reached",
        description:
          "This period's spending cap has been reached. Raise the cap in billing settings to continue.",
        primaryAction: openBilling,
        secondaryAction: null,
      };
    case "payment_failed":
    case "external_billing_hold":
      if (!opts.canManageBilling) {
        return memberView("Billing needs attention", "Cloud usage is paused.");
      }
      return {
        kind: "payment",
        title: "Billing needs attention",
        description:
          "Cloud usage is paused because the last payment didn't go through. Update your payment method to resume.",
        primaryAction: openBilling,
        secondaryAction: null,
      };
    case "admin_hold":
      if (!opts.canManageBilling) {
        return memberView("Account on hold", "Cloud usage is paused on this account.");
      }
      return {
        kind: "admin",
        title: "Account on hold",
        description: "Cloud usage is paused on this account. Contact support to resolve the hold.",
        primaryAction: null,
        secondaryAction: openBilling,
      };
    case "concurrency_limit":
      // Not a billing repair: the fix is freeing a sandbox slot, so no
      // billing CTA (matches cloud-workspace-status-presentation copy).
      return {
        kind: "limit",
        title: "Sandbox limit reached",
        description:
          "Archive or delete another cloud workspace before starting this one.",
        primaryAction: null,
        secondaryAction: null,
      };
    case "llm_credits_exhausted":
      if (!opts.canManageBilling) {
        return memberView("Out of LLM credits", "Model usage is paused until credits are added.");
      }
      return opts.isPaidPlan
        ? {
            kind: "refill",
            title: "Out of LLM credits",
            description: "Model usage is paused. Add credits to keep your agents running.",
            primaryAction: refill ?? openBilling,
            secondaryAction: refill ? openBilling : null,
          }
        : {
            kind: "upgrade",
            title: "Out of LLM credits",
            description: "Model usage is paused. Upgrade to keep your agents running.",
            primaryAction: upgrade ?? openBilling,
            secondaryAction: upgrade ? openBilling : null,
          };
    case "llm_limit_reached":
      if (!opts.canManageBilling) {
        return memberView("Usage limit reached", "A spending limit for this period has been reached.");
      }
      return {
        kind: "limit",
        title: "Usage limit reached",
        description:
          "A spending limit for this period has been reached. Adjust limits in billing settings to continue.",
        primaryAction: openBilling,
        secondaryAction: null,
      };
    default:
      return {
        kind: "limit",
        title: "Cloud usage paused",
        description: "Usage is paused for a billing reason. Check billing settings for details.",
        primaryAction: openBilling,
        secondaryAction: null,
      };
  }
}
