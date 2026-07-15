import { SettingsSection } from "@proliferate/product-ui/settings/SettingsSection";
import { SettingsRow } from "@proliferate/product-ui/settings/SettingsRow";
import { ExternalLink } from "@proliferate/ui/icons";
import { Badge } from "@proliferate/ui/primitives/Badge";
import { Button } from "@proliferate/ui/primitives/Button";
import { SkeletonBlock } from "@proliferate/ui/primitives/Skeleton";
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
  errorMessage,
  unavailableMessage,
  actionError,
  onRetry,
  onManage,
}: {
  plan: BillingPlanPresentation | null;
  organization: BillingSettingsOrganization | null;
  organizationLoading: boolean;
  loading: boolean;
  errorMessage: string | null;
  unavailableMessage: string | null;
  actionError: string | null;
  onRetry: () => void;
  onManage: () => void;
}) {
  const context = organizationLoading
    ? "Billing details for this organization."
    : organization
      ? `Billing for ${organization.name}.`
      : "Billing for your personal account.";

  const label = loading && !plan
    ? "Loading billing plan"
    : errorMessage
      ? "Billing plan unavailable"
      : unavailableMessage
        ? "Billing unavailable"
        : plan
          ? (
              <span className="flex flex-wrap items-center gap-2">
                {plan.name}
                <span className="font-normal text-muted-foreground">{plan.price}</span>
                <Badge tone={plan.badgeTone}>{plan.badge}</Badge>
              </span>
            )
          : "Billing plan unavailable";

  const description = errorMessage ?? unavailableMessage ?? context;

  return (
    <SettingsSection title="Plan">
      <SettingsRow
        label={label}
        description={description}
      >
        {loading && !plan ? (
          <SkeletonBlock className="h-8 w-20" />
        ) : errorMessage ? (
          <Button type="button" variant="secondary" onClick={onRetry}>
            Retry
          </Button>
        ) : plan ? (
          <Button
            type="button"
            variant="primary"
            disabled={organizationLoading}
            onClick={onManage}
          >
            Manage
          </Button>
        ) : null}
      </SettingsRow>
      {actionError ? (
        <p className="pt-2 text-ui-sm text-destructive">{actionError}</p>
      ) : null}
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
      <SettingsRow
        label="Enable auto top-up"
        description="Replenish balances automatically when they fall below the configured threshold."
      >
        <div className="flex items-center gap-2">
          {saving ? <span className="text-ui-sm text-muted-foreground">Saving…</span> : null}
          <Switch
            checked={enabled}
            onChange={onEnabledChange}
            disabled={disabled}
            aria-label="Auto top-up"
          />
        </div>
      </SettingsRow>
      <SettingsRow
        label="Compute auto top-up"
        description="Replenish compute units when runtime capacity falls below the configured threshold."
      />
      <SettingsRow
        label="LLM credit auto top-up"
        description="Replenish LLM credits when model usage balance falls below the configured threshold."
      />
      <SettingsRow label="Last auto top-up">
        <span className="text-ui-sm text-muted-foreground">Not yet run</span>
      </SettingsRow>
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
      title="Billing portal"
      description="View invoices, update payment methods, and manage cancellation in Stripe."
    >
      <SettingsRow
        label="Stripe billing portal"
        description="Open the Stripe-hosted portal to manage payment details for this organization."
      >
        <Button
          type="button"
          variant="primary"
          loading={loading}
          disabled={disabled}
          onClick={onOpenPortal}
        >
          Access billing portal
          <ExternalLink className="size-3.5" />
        </Button>
      </SettingsRow>
    </SettingsSection>
  );
}
