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
    <SettingsSection
      title="Usage units"
      description="Compute units and LLM credits are tracked, budgeted, and topped up separately."
    >
      <div className="grid gap-4 pt-1">
        {unitBalances.map((unitBalance) => (
          <BillingUnitPoolCard
            key={unitBalance.kind}
            unitBalance={unitBalance}
            addCreditsLoading={addCreditsLoading}
            addCreditsDisabled={addCreditsDisabled}
          />
        ))}
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
      <div className="space-y-4 p-4">
        <div className="space-y-1">
          <h3 className="text-ui font-medium text-foreground">{unitBalance.title}</h3>
          <p className="text-ui-sm leading-[1.45] text-muted-foreground">{unitBalance.description}</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <BillingMetric label="Total purchased" value={unitBalance.purchased} />
          <BillingMetric label="Available" value={unitBalance.available} />
          <BillingMetric label="Used" value={unitBalance.used} />
        </div>

        <ProgressBar
          value={unitBalance.availablePercent ?? 0}
          className="h-2.5 overflow-hidden rounded-full bg-foreground/10"
          indicatorClassName="h-full rounded-full bg-primary/70"
          aria-label={`${unitBalance.title} available`}
        />
      </div>

      <div className="flex flex-col gap-2 border-t border-border-light bg-background/40 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="text-ui font-medium text-foreground">
            Top up {unitBalance.title.toLowerCase()}
          </div>
          <p className="text-ui-sm leading-[1.45] text-muted-foreground">
            Credit pack checkout for organizations is coming soon.
          </p>
        </div>
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
    </section>
  );
}

function BillingMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="mb-1 text-ui-sm text-muted-foreground">{label}</p>
      <p className="break-words text-lg font-semibold leading-tight text-foreground">{value}</p>
    </div>
  );
}
