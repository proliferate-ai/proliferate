import { SettingsSection } from "#product/primitives/patterns/settings/SettingsSection";
import { SettingsRow } from "#product/primitives/patterns/settings/SettingsRow";
import { Button } from "#product/primitives/Button";
import { ProgressBar } from "#product/primitives/ProgressBar";
import { LoadingBoundary } from "#product/primitives/LoadingBoundary";
import type { BillingUnitBalancePresentation } from "#product/lib/domain/settings/billing-settings-presentation";

export function BillingUsageUnitsSection({
  unitBalances,
  addCreditsLoading,
  addCreditsDisabled,
}: {
  unitBalances: BillingUnitBalancePresentation[];
  addCreditsLoading: boolean;
  addCreditsDisabled: boolean;
}) {
  return (
    <SettingsSection
      title="Usage"
      description="Compute units and LLM credits are tracked and topped up separately."
    >
      {unitBalances.map((balance) => (
        <BillingUnitPoolRow
          key={balance.kind}
          balance={balance}
          addCreditsLoading={addCreditsLoading}
          addCreditsDisabled={addCreditsDisabled}
        />
      ))}
    </SettingsSection>
  );
}

function BillingUnitPoolRow({
  balance,
  addCreditsLoading,
  addCreditsDisabled,
}: {
  balance: BillingUnitBalancePresentation;
  addCreditsLoading: boolean;
  addCreditsDisabled: boolean;
}) {
  const percent = balance.availablePercent ?? 0;

  if (balance.state === "loading") {
    // Class C big-surface treatment (UX Latency + Transitions ADR §4 Rung 4,
    // FR-1): retired the placeholder skeleton. The row's label + description
    // are the stable shell; the balance slot shows nothing until the pool
    // balance resolves.
    return (
      <SettingsRow label={balance.title} description={balance.description}>
        <LoadingBoundary
          state="pending"
          diagnostics={{ flow: "billing_unit_pool" }}
          treatment={null}
        />
      </SettingsRow>
    );
  }

  if (balance.state !== "ready") {
    return (
      <SettingsRow
        label={balance.title}
        description={balance.stateMessage ?? `${balance.title} are unavailable.`}
      >
        {balance.state === "error" && balance.onRetry ? (
          <Button type="button" variant="secondary" size="sm" onClick={balance.onRetry}>
            Retry
          </Button>
        ) : null}
      </SettingsRow>
    );
  }

  return (
    <SettingsRow
      label={balance.title}
      description={(
        // A <div>, not a <span>: ProgressBar's root is a <div>, and flow
        // content may not nest inside phrasing content. SettingsRow renders
        // `description` inside a <div>, so this is legal where it lands.
        <div className="flex flex-col gap-1.5">
          <span>{balance.available} of {balance.purchased} available</span>
          <ProgressBar
            value={percent}
            className="block h-1 w-24 overflow-hidden rounded-full bg-surface-control"
            indicatorClassName="block h-full rounded-full bg-foreground/40"
            aria-label={`${balance.title} available`}
          />
        </div>
      )}
    >
      <Button
        type="button"
        variant="secondary"
        size="sm"
        loading={addCreditsLoading}
        disabled={addCreditsDisabled}
      >
        {balance.topUpLabel}
      </Button>
    </SettingsRow>
  );
}
