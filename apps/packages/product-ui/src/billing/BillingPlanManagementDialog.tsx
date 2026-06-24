import { Badge } from "@proliferate/ui/primitives/Badge";
import { Button } from "@proliferate/ui/primitives/Button";
import { ModalShell } from "@proliferate/ui/primitives/ModalShell";

import type { BillingPlanColumn } from "./billing-plan-ladder";
import type { BillingActionView } from "./billing-types";
import { BillingButton } from "./BillingUiParts";

const CORE_CREDIT_OPTIONS = [
  { credits: 20, label: "Starter", detail: "Baseline Core membership for a small team." },
  { credits: 50, label: "Standard", detail: "More room for shared workflows and cloud work." },
  { credits: 100, label: "Growth", detail: "Higher monthly usage for active product teams." },
  { credits: 200, label: "Scale", detail: "Expanded pool for repeated cloud sessions." },
  { credits: 500, label: "Discounted", detail: "Best Core rate for heavy usage." },
];

export interface BillingPlanManagementDialogProps {
  open: boolean;
  onClose: () => void;
  currentPlanKey: BillingPlanColumn["key"] | null;
  organizationName?: string | null;
  coreAction?: BillingActionView;
  portalAction?: BillingActionView;
  enterpriseAction?: BillingActionView;
  pricingAction?: BillingActionView;
}

export function BillingPlanManagementDialog({
  open,
  onClose,
  currentPlanKey,
  organizationName,
  coreAction,
  portalAction,
  enterpriseAction,
  pricingAction,
}: BillingPlanManagementDialogProps) {
  const isCore = currentPlanKey === "core";

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title="Manage plan"
      description="Review Core credit memberships, billing portal access, and Enterprise options."
      sizeClassName="max-w-2xl"
      bodyClassName="max-h-[min(720px,calc(100vh-10rem))] overflow-y-auto px-5 pb-5 pt-2"
      footer={pricingAction ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={pricingAction.onClick}
          disabled={pricingAction.disabled}
        >
          {pricingAction.label}
        </Button>
      ) : undefined}
    >
      <div className="space-y-5">
        <section className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1">
              <h3 className="text-sm font-medium text-foreground">Core credit memberships</h3>
              <p className="max-w-xl text-xs leading-5 text-muted-foreground">
                {organizationName
                  ? `Applies to ${organizationName} organization cloud work.`
                  : "Create an organization before registering for Core."}
              </p>
            </div>
            {isCore ? <Badge tone="success">Current</Badge> : null}
          </div>

          <div className="overflow-hidden rounded-lg border border-border-light">
            {CORE_CREDIT_OPTIONS.map((option, index) => (
              <div
                key={option.credits}
                className={`grid gap-3 p-3 sm:grid-cols-[8rem_1fr_auto] sm:items-center ${
                  index === CORE_CREDIT_OPTIONS.length - 1 ? "" : "border-b border-border-light"
                }`}
              >
                <div className="text-sm font-medium text-foreground">{option.credits} PCUs</div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-foreground">
                    {option.label}
                    {option.credits === 500 ? <Badge tone="info">Discounted</Badge> : null}
                  </div>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">{option.detail}</p>
                </div>
                <div className="text-xs text-muted-foreground">Monthly</div>
              </div>
            ))}
          </div>

          {coreAction ? (
            <BillingButton action={coreAction} variant="primary" className="w-full sm:w-auto" />
          ) : null}
        </section>

        {portalAction ? (
          <section className="flex flex-col gap-3 rounded-lg border border-border-light p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 space-y-1">
              <h3 className="text-sm font-medium text-foreground">Billing portal</h3>
              <p className="text-xs leading-5 text-muted-foreground">
                Change payment method, invoices, and cancellation in Stripe.
              </p>
            </div>
            <BillingButton action={portalAction} variant="secondary" className="shrink-0" />
          </section>
        ) : null}

        <section className="flex flex-col gap-3 rounded-lg border border-border-light p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 space-y-1">
            <h3 className="text-sm font-medium text-foreground">Enterprise</h3>
            <p className="text-xs leading-5 text-muted-foreground">
              Custom credits, SSO, org-wide secrets, audit trails, custom instances, and VPC deployment.
            </p>
          </div>
          {enterpriseAction ? (
            <BillingButton action={enterpriseAction} variant="outline" className="shrink-0" />
          ) : null}
        </section>
      </div>
    </ModalShell>
  );
}
