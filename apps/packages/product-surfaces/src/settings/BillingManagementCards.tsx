import { SettingsSection } from "@proliferate/product-ui/settings/SettingsSection";
import { ExternalLink } from "@proliferate/ui/icons";
import { Badge } from "@proliferate/ui/primitives/Badge";
import { Button } from "@proliferate/ui/primitives/Button";
import { Switch } from "@proliferate/ui/primitives/Switch";
import type { BillingSettingsOrganization } from "./BillingSettingsSurface";

export interface BillingPlanPresentation {
  name: string;
  price: string;
  badge: string;
  badgeTone: "neutral" | "success" | "info" | "warning" | "destructive";
}

export function BillingPlanCard({
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
    <SettingsSection title="Plan">
      <div className="space-y-4 pt-1">
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
    </SettingsSection>
  );
}

export function BillingAutoTopUpCard({
  enabled,
  disabled,
  saving,
  onEnabledChange,
}: {
  enabled: boolean;
  disabled: boolean;
  saving: boolean;
  onEnabledChange: (value: boolean) => void;
}) {
  return (
    <SettingsSection
      title="Auto top-up"
      description="Automatically replenish compute units and LLM credits from their own thresholds."
    >
      <div className="space-y-6 pt-1">
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
            description="Replenish compute units when runtime capacity falls below the configured threshold."
          />
          <AutoTopUpSummary
            label="LLM credit auto top-up"
            description="Replenish LLM credits when model usage balance falls below the configured threshold."
          />
        </div>

        <p className="text-sm text-muted-foreground">Last auto top-up: not yet run.</p>
      </div>
    </SettingsSection>
  );
}

export function BillingPortalCard({
  loading,
  disabled,
  onOpenPortal,
}: {
  loading: boolean;
  disabled: boolean;
  onOpenPortal: () => void;
}) {
  return (
    <SettingsSection
      title="Billing"
      description="View invoices, update payment methods, and manage cancellation in Stripe."
    >
      <div className="pt-1">
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
    </SettingsSection>
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
