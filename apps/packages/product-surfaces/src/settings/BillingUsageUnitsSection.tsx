import { SettingsSection } from "@proliferate/product-ui/settings/SettingsSection";
import { SettingsRow } from "@proliferate/product-ui/settings/SettingsRow";
import { Button } from "@proliferate/ui/primitives/Button";

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
