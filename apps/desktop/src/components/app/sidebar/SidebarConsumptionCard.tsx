import type { UsageSummary } from "@proliferate/cloud-sdk";
import { Button } from "@proliferate/ui/primitives/Button";
import { ProgressBar } from "@proliferate/ui/primitives/ProgressBar";

type ConsumptionMeterTone = "default" | "warning" | "destructive";

interface ConsumptionMeterState {
  percent: number | null;
  blocked: boolean;
  tone: ConsumptionMeterTone;
}

const CONSUMPTION_NEAR_LIMIT_PERCENT = 80;

const CONSUMPTION_METER_INDICATOR_CLASS: Record<ConsumptionMeterTone, string> = {
  default: "h-full rounded-full bg-primary/70",
  warning: "h-full rounded-full bg-warning-foreground",
  destructive: "h-full rounded-full bg-destructive",
};

const CONSUMPTION_METER_TEXT_CLASS: Record<ConsumptionMeterTone, string> = {
  default: "text-sidebar-muted-foreground",
  warning: "text-warning-foreground",
  destructive: "text-destructive",
};

/**
 * The tightest enabled limit (if any) wins per §3.1's `*Limit` contract; when
 * there is no limit we fall back to used/remaining balance for the bar and
 * treat an exhausted balance as blocked.
 */
function resolveConsumptionMeterState(
  usedValue: number,
  remainingValue: number | null,
  limit: UsageSummary["computeLimit"],
): ConsumptionMeterState {
  let percent: number | null;
  let blocked: boolean;

  if (limit) {
    percent = limit.capValue > 0
      ? Math.min(100, (limit.usedValue / limit.capValue) * 100)
      : 100;
    blocked = limit.blocked;
  } else if (remainingValue !== null) {
    const total = usedValue + remainingValue;
    percent = total > 0 ? Math.min(100, (usedValue / total) * 100) : 0;
    blocked = remainingValue <= 0;
  } else {
    percent = null;
    blocked = false;
  }

  const tone: ConsumptionMeterTone = blocked
    ? "destructive"
    : percent !== null && percent >= CONSUMPTION_NEAR_LIMIT_PERCENT
      ? "warning"
      : "default";

  return { percent, blocked, tone };
}

function formatRemainingHours(seconds: number | null): string {
  if (seconds === null) {
    return "Unlimited";
  }
  const hours = Math.max(seconds, 0) / 3600;
  return `${hours.toLocaleString(undefined, { maximumFractionDigits: 1 })}h left`;
}

function formatRemainingUsd(usd: number): string {
  return `$${Math.max(usd, 0).toFixed(2)} left`;
}

function ConsumptionMeterRow({
  label,
  state,
  remainingLabel,
}: {
  label: string;
  state: ConsumptionMeterState;
  remainingLabel: string;
}) {
  return (
    <div className="flex items-center gap-2 px-2.5 py-1">
      <span className="w-20 shrink-0 text-ui-sm text-sidebar-foreground">{label}</span>
      <ProgressBar
        value={state.percent ?? 0}
        className="h-1.5 flex-1 overflow-hidden rounded-full bg-sidebar-accent"
        indicatorClassName={CONSUMPTION_METER_INDICATOR_CLASS[state.tone]}
        aria-label={`${label} usage`}
      />
      <span className={`shrink-0 text-ui-sm ${CONSUMPTION_METER_TEXT_CLASS[state.tone]}`}>
        {remainingLabel}
      </span>
    </div>
  );
}

/**
 * Compute + LLM usage meters, personal scope only (an admin's org-wide view
 * lives in Usage & limits settings — spec decision). Rendered always-visible
 * in the sidebar directly above the account footer, not inside its popover.
 */
export function ConsumptionCard({
  usageSummary,
  onTopUp,
}: {
  usageSummary: UsageSummary;
  onTopUp: () => void;
}) {
  const computeState = resolveConsumptionMeterState(
    usageSummary.computeUsedSecondsMtd,
    usageSummary.computeRemainingSeconds,
    usageSummary.computeLimit,
  );
  const llmState = resolveConsumptionMeterState(
    usageSummary.llmUsedUsdMtd,
    usageSummary.llmRemainingUsd,
    usageSummary.llmLimit,
  );
  const blocked = computeState.blocked || llmState.blocked;

  return (
    <div className="border-t border-border-light py-1">
      <ConsumptionMeterRow
        label="Compute"
        state={computeState}
        remainingLabel={formatRemainingHours(usageSummary.computeRemainingSeconds)}
      />
      <ConsumptionMeterRow
        label="LLM credits"
        state={llmState}
        remainingLabel={formatRemainingUsd(usageSummary.llmRemainingUsd)}
      />
      {blocked ? (
        <div className="px-2.5 pt-1">
          {usageSummary.canSelfServeTopUp ? (
            <Button type="button" variant="secondary" size="sm" className="w-full" onClick={onTopUp}>
              Top up
            </Button>
          ) : (
            <div className="text-ui-sm text-destructive">Ask your admin to raise your limit.</div>
          )}
        </div>
      ) : null}
    </div>
  );
}
