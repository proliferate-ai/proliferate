import { SettingsSection } from "@proliferate/product-ui/settings/SettingsSection";
import { SettingsRow } from "@proliferate/product-ui/settings/SettingsRow";
import { Button } from "@proliferate/ui/primitives/Button";
import { SkeletonBlock, shimmerDelay } from "@proliferate/ui/primitives/Skeleton";

export type BillingUnitKind = "compute" | "llm";

export interface BillingUnitBalancePresentation {
  kind: BillingUnitKind;
  title: string;
  description: string;
  purchased: string;
  available: string;
  used: string;
  availablePercent: number | null;
  topUpLabel: string;
  lowBalanceCopy: string;
  loading?: boolean;
}

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

  if (balance.loading) {
    return (
      <SettingsRow label={balance.title} description={balance.description}>
        <div className="flex flex-col gap-1.5" role="status" aria-label={`Loading ${balance.title}`}>
          <SkeletonBlock className="h-3 w-32" style={shimmerDelay(0)} />
          <SkeletonBlock className="h-1 w-24 rounded-full" style={shimmerDelay(1)} />
        </div>
      </SettingsRow>
    );
  }

  return (
    <SettingsRow
      label={balance.title}
      description={(
        <span className="flex flex-col gap-1.5">
          <span>{balance.available} of {balance.purchased} available</span>
          <span
            className="block h-1 w-24 overflow-hidden rounded-full bg-foreground/10"
            role="progressbar"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${balance.title} available`}
          >
            <span
              className="block h-full rounded-full bg-foreground/40"
              style={{ width: `${percent}%` }}
            />
          </span>
        </span>
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
