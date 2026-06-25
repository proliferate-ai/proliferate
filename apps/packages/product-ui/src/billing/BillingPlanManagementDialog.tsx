import type { ReactNode } from "react";

import { Check } from "@proliferate/ui/icons";
import { Badge } from "@proliferate/ui/primitives/Badge";
import { Button } from "@proliferate/ui/primitives/Button";
import { Input } from "@proliferate/ui/primitives/Input";
import { ModalShell } from "@proliferate/ui/primitives/ModalShell";
import { Select } from "@proliferate/ui/primitives/Select";

import type { BillingPlanColumn } from "./billing-plan-ladder";
import type { BillingActionView } from "./billing-types";
import { BillingButton, Notice } from "./BillingUiParts";

const CORE_COMPUTE_TIERS = [
  { value: "20", label: "20 PCUs / month" },
  { value: "50", label: "50 PCUs / month" },
  { value: "100", label: "100 PCUs / month" },
  { value: "200", label: "200 PCUs / month" },
  { value: "500", label: "500 PCUs / month" },
];

const CORE_LLM_TIERS = [
  { value: "2500", label: "2,500 LLM credits / month" },
  { value: "5000", label: "5,000 LLM credits / month" },
  { value: "10000", label: "10,000 LLM credits / month" },
  { value: "25000", label: "25,000 LLM credits / month" },
];

const CORE_FEATURES = [
  "Separate compute unit and LLM credit pools",
  "Runtime usage billed against compute units",
  "Model gateway usage billed against LLM credits",
  "Unlimited workflows per person",
  "Unlimited team members",
  "Beta access and role-based access management",
];

const ENTERPRISE_FEATURES = [
  "Custom compute unit and LLM credit pools",
  "SSO, org-wide secrets, and audit trails",
  "Bring your own model credentials",
  "Custom instance types or VPC deployment",
  "Dedicated account manager, FDE, and premium support",
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
  actionErrorMessage?: string | null;
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
  actionErrorMessage,
}: BillingPlanManagementDialogProps) {
  const isCore = currentPlanKey === "core";

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title="Choose your plan"
      description="Choose compute units and LLM credits, review Enterprise, or open Stripe billing."
      sizeClassName="max-w-6xl"
      bodyClassName="max-h-[min(760px,calc(100vh-10rem))] overflow-y-auto px-5 pb-5 pt-2"
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
        {actionErrorMessage ? (
          <Notice
            tone="destructive"
            title="Plan action failed"
            description={actionErrorMessage}
          />
        ) : null}

        <div className="grid gap-4 lg:grid-cols-2">
          <PlanOptionCard
            title="Core"
            eyebrow={isCore ? "Current plan" : "Team plan"}
            badge={isCore ? "Current" : undefined}
            description={
              organizationName
                ? `Monthly compute units, LLM credits, and shared controls for ${organizationName}.`
                : "Monthly compute units, LLM credits, and shared controls for organizations."
            }
            summary="From 20 PCUs + 2,500 LLM credits / month"
            features={CORE_FEATURES}
            action={coreAction}
            actionVariant="primary"
          >
            <div className="space-y-2">
              <label className="block text-sm font-medium text-foreground" htmlFor="core-compute-tier">
                Monthly compute units
              </label>
              <Select id="core-compute-tier" defaultValue="20">
                {CORE_COMPUTE_TIERS.map((tier) => (
                  <option key={tier.value} value={tier.value}>{tier.label}</option>
                ))}
              </Select>
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-medium text-foreground" htmlFor="core-llm-tier">
                Monthly LLM credits
              </label>
              <Select id="core-llm-tier" defaultValue="2500">
                {CORE_LLM_TIERS.map((tier) => (
                  <option key={tier.value} value={tier.value}>{tier.label}</option>
                ))}
              </Select>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                aria-label="Coupon code"
                placeholder="Coupon code"
                className="sm:flex-1"
              />
              <Button type="button" variant="secondary" disabled className="sm:w-auto">
                Apply
              </Button>
            </div>

            {portalAction ? (
              <BillingButton action={portalAction} variant="secondary" className="w-full" />
            ) : null}
          </PlanOptionCard>

          <PlanOptionCard
            title="Enterprise"
            eyebrow="Custom plan"
            badge={currentPlanKey === "enterprise" ? "Current" : undefined}
            description="Security, deployment, and support for larger teams."
            summary="Custom compute + LLM credits"
            features={ENTERPRISE_FEATURES}
            action={enterpriseAction}
            actionVariant="outline"
          />
        </div>
      </div>
    </ModalShell>
  );
}

function PlanOptionCard({
  title,
  eyebrow,
  badge,
  description,
  summary,
  features,
  action,
  actionVariant,
  children,
}: {
  title: string;
  eyebrow: string;
  badge?: string;
  description: string;
  summary: string;
  features: string[];
  action?: BillingActionView;
  actionVariant: "primary" | "outline";
  children?: ReactNode;
}) {
  return (
    <section className="flex min-h-[34rem] flex-col rounded-xl border border-border-light bg-surface-elevated p-5">
      <div className="space-y-4">
        <div className="flex min-h-6 items-center justify-between gap-3">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{eyebrow}</div>
          {badge ? <Badge tone="success">{badge}</Badge> : null}
        </div>

        <div className="space-y-1">
          <h3 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h3>
          <p className="text-sm leading-5 text-muted-foreground">{description}</p>
        </div>

        <div className="text-lg font-semibold text-foreground">{summary}</div>
      </div>

      <div className="mt-5 space-y-3">
        {features.map((feature) => (
          <div key={feature} className="flex gap-2 text-sm leading-5 text-foreground">
            <Check className="mt-0.5 size-4 shrink-0 text-success" />
            <span>{feature}</span>
          </div>
        ))}
      </div>

      {children ? <div className="mt-5 space-y-3">{children}</div> : null}

      <div className="mt-auto pt-5">
        {action ? (
          <BillingButton action={action} variant={actionVariant} className="w-full" />
        ) : null}
      </div>
    </section>
  );
}
