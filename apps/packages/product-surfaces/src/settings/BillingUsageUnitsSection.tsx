import { SettingsSection } from "@proliferate/product-ui/settings/SettingsSection";
import { Button } from "@proliferate/ui/primitives/Button";
import { ProgressBar } from "@proliferate/ui/primitives/ProgressBar";

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
    <SettingsSection>
      <div className="space-y-6 p-5">
        <div className="space-y-1.5">
          <h2 className="text-lg font-semibold text-foreground">Usage units</h2>
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
            Compute units and LLM credits are tracked, budgeted, and topped up separately.
          </p>
        </div>

        <div className="grid gap-4">
          {unitBalances.map((unitBalance) => (
            <BillingUnitPoolCard
              key={unitBalance.kind}
              unitBalance={unitBalance}
              addCreditsLoading={addCreditsLoading}
              addCreditsDisabled={addCreditsDisabled}
            />
          ))}
        </div>
      </div>
    </SettingsSection>
  );
}

function BillingUnitPoolCard({
  unitBalance,
  addCreditsLoading,
  addCreditsDisabled,
}: {
  unitBalance: BillingUnitBalancePresentation;
  addCreditsLoading: boolean;
  addCreditsDisabled: boolean;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-border-light bg-foreground/[0.02]">
      <div className="space-y-5 p-4">
        <div className="space-y-1">
          <h3 className="text-base font-semibold text-foreground">{unitBalance.title}</h3>
          <p className="text-sm leading-5 text-muted-foreground">{unitBalance.description}</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <BillingMetric label="Total purchased" value={unitBalance.purchased} />
          <BillingMetric label="Available" value={unitBalance.available} />
          <BillingMetric label="Used" value={unitBalance.used} />
        </div>

        <ProgressBar
          value={unitBalance.availablePercent ?? 0}
          className="h-4 overflow-hidden rounded-full border border-border-light bg-foreground/5 p-0.5"
          indicatorClassName="h-full rounded-full bg-primary/70"
          aria-label={`${unitBalance.title} available`}
        />
      </div>

      <div className="border-t border-border-light bg-background/40 p-4">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <h4 className="text-sm font-medium text-foreground">
              Top up {unitBalance.title.toLowerCase()}
            </h4>
            <p className="mt-1 text-sm leading-5 text-muted-foreground">
              {unitBalance.lowBalanceCopy}
            </p>
          </div>
        </div>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            Credit pack checkout for organizations is coming soon.
          </p>
          <Button
            type="button"
            variant="secondary"
            loading={addCreditsLoading}
            disabled={addCreditsDisabled}
            className="w-full sm:w-auto"
          >
            {unitBalance.topUpLabel}
          </Button>
        </div>
      </div>
    </section>
  );
}

function BillingMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="mb-1 text-sm text-muted-foreground">{label}</p>
      <p className="break-words text-xl font-semibold leading-tight text-foreground sm:text-2xl">
        {value}
      </p>
    </div>
  );
}
