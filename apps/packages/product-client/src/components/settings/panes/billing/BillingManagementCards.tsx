import { SettingsSection } from "#product/components/patterns/SettingsSection";
import { SettingsRow } from "#product/components/patterns/SettingsRow";
import { ExternalLink } from "#product/primitives/icons/core";
import { Badge } from "#product/primitives/Badge";
import { Button } from "#product/primitives/Button";
import { SkeletonBlock } from "#product/primitives/Skeleton";
import { Switch } from "#product/primitives/Switch";
import type {
  BillingPlanPresentation,
  BillingSettingsOrganization,
} from "#product/lib/domain/settings/billing-settings-presentation";

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
    <div>
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
      </SettingsSection>
      {actionError ? (
        <p className="mt-2 text-ui-sm text-destructive">{actionError}</p>
      ) : null}
    </div>
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
          <ExternalLink className="icon-compact" />
        </Button>
      </SettingsRow>
    </SettingsSection>
  );
}
