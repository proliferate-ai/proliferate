import { forwardRef, type ButtonHTMLAttributes } from "react";
import type { UsageSummary } from "@proliferate/cloud-sdk";
import { Button } from "@proliferate/ui/primitives/Button";

type ConsumptionMeterTone = "default" | "warning" | "destructive";

interface ConsumptionMeterState {
  percent: number | null;
  blocked: boolean;
  tone: ConsumptionMeterTone;
}

export type SidebarConsumptionState =
  | { kind: "loading" }
  | { kind: "unavailable"; message: string }
  | { kind: "ready"; usageSummary: UsageSummary };

export type SidebarConsumptionMeter = "compute" | "llm";

const CONSUMPTION_NEAR_LIMIT_PERCENT = 80;
const RING_RADIUS = 8;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

const CONSUMPTION_METER_TEXT_CLASS: Record<ConsumptionMeterTone, string> = {
  default: "text-sidebar-muted-foreground",
  warning: "text-warning-foreground",
  destructive: "text-destructive",
};

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

function metersForState(state: SidebarConsumptionState) {
  if (state.kind !== "ready") {
    return null;
  }
  return {
    compute: resolveConsumptionMeterState(
      state.usageSummary.computeUsedSecondsMtd,
      state.usageSummary.computeRemainingSeconds,
      state.usageSummary.computeLimit,
    ),
    llm: resolveConsumptionMeterState(
      state.usageSummary.llmUsedUsdMtd,
      state.usageSummary.llmRemainingUsd,
      state.usageSummary.llmLimit,
    ),
  };
}

interface SidebarUsageMeterTriggerProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  meter: SidebarConsumptionMeter;
  state: SidebarConsumptionState;
}

/** One independently labeled, focusable ring trigger for the usage concern. */
export const SidebarUsageMeterTrigger = forwardRef<
  HTMLButtonElement,
  SidebarUsageMeterTriggerProps
>(function SidebarUsageMeterTrigger({
  meter,
  state,
  className = "",
  onKeyDown,
  ...buttonProps
}, ref) {
  const meters = metersForState(state);
  const fallbackTone: ConsumptionMeterTone = state.kind === "unavailable"
    ? "destructive"
    : "default";
  const label = meter === "compute" ? "Compute" : "LLM";
  const shortLabel = meter === "compute" ? "C" : "L";
  const percent = meters?.[meter].percent ?? null;
  const tone = meters?.[meter].tone ?? fallbackTone;
  const percentLabel = percent === null ? null : `${Math.round(percent)}% used`;
  const statusLabel = state.kind === "loading"
    ? "loading"
    : state.kind === "unavailable"
      ? "unavailable"
      : percentLabel ?? "unlimited";
  const dashOffset = percent === null
    ? RING_CIRCUMFERENCE
    : RING_CIRCUMFERENCE * (1 - Math.max(0, Math.min(100, percent)) / 100);

  return (
    <Button
      {...buttonProps}
      ref={ref}
      type="button"
      variant="unstyled"
      size="unstyled"
      aria-label={`${label} usage, ${statusLabel}. Open usage details`}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (!event.defaultPrevented && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          event.currentTarget.click();
        }
      }}
      className={`relative flex size-7 shrink-0 items-center justify-center rounded-full text-sidebar-muted-foreground outline-none hover:text-sidebar-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-sidebar-ring data-[state=open]:text-sidebar-foreground ${className}`}
    >
      <svg viewBox="0 0 20 20" className="size-5 -rotate-90" aria-hidden="true">
        <circle
          cx="10"
          cy="10"
          r={RING_RADIUS}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          className="opacity-20"
        />
        <circle
          cx="10"
          cy="10"
          r={RING_RADIUS}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeDasharray={RING_CIRCUMFERENCE}
          strokeDashoffset={dashOffset}
          className={CONSUMPTION_METER_TEXT_CLASS[tone]}
        />
      </svg>
      <span className="pointer-events-none absolute text-[7px] font-semibold leading-none text-sidebar-foreground" aria-hidden="true">
        {state.kind === "unavailable" ? "!" : shortLabel}
      </span>
    </Button>
  );
});

function ConsumptionDetailRow({
  label,
  state,
  remainingLabel,
}: {
  label: string;
  state: ConsumptionMeterState;
  remainingLabel: string;
}) {
  const usedLabel = state.percent === null ? "No limit" : `${Math.round(state.percent)}% used`;
  return (
    <div className="flex items-center justify-between gap-3 px-2.5 py-1.5">
      <div>
        <div className="text-ui text-sidebar-foreground">{label}</div>
        <div className={`text-ui-sm ${CONSUMPTION_METER_TEXT_CLASS[state.tone]}`}>
          {usedLabel}
        </div>
      </div>
      <div className={`text-right text-ui-sm ${CONSUMPTION_METER_TEXT_CLASS[state.tone]}`}>
        {remainingLabel}
      </div>
    </div>
  );
}

/** Usage detail surface opened by the circular footer meters. */
export function ConsumptionCard({
  state,
  onRetry,
  onTopUp,
  onBilling,
}: {
  state: SidebarConsumptionState;
  onRetry?: () => void;
  onTopUp?: () => void;
  onBilling?: () => void;
}) {
  if (state.kind === "loading") {
    return (
      <div className="px-3 py-3 text-ui text-sidebar-muted-foreground" role="status">
        Loading usage…
      </div>
    );
  }

  if (state.kind === "unavailable") {
    return (
      <div className="space-y-2 px-3 py-3">
        <div className="text-ui text-sidebar-foreground">Usage unavailable</div>
        <div className="text-ui-sm text-sidebar-muted-foreground">{state.message}</div>
        {onRetry ? (
          <Button type="button" variant="secondary" size="sm" className="w-full" onClick={onRetry}>
            Try again
          </Button>
        ) : null}
      </div>
    );
  }

  const meters = metersForState(state)!;
  const blocked = meters.compute.blocked || meters.llm.blocked;

  return (
    <div className="py-1">
      <div className="px-2.5 pb-1 pt-1 text-ui-sm font-medium text-sidebar-muted-foreground">
        Usage
      </div>
      <ConsumptionDetailRow
        label="Compute"
        state={meters.compute}
        remainingLabel={formatRemainingHours(state.usageSummary.computeRemainingSeconds)}
      />
      <ConsumptionDetailRow
        label="LLM"
        state={meters.llm}
        remainingLabel={formatRemainingUsd(state.usageSummary.llmRemainingUsd)}
      />
      {blocked && !onTopUp ? (
        <div className="px-2.5 py-1.5 text-ui-sm text-destructive">
          Ask your admin to raise your limit.
        </div>
      ) : null}
      {onTopUp || onBilling ? (
        <div className="mt-1 flex gap-2 border-t border-border-light px-2 py-2">
          {onTopUp ? (
            <Button type="button" variant="secondary" size="sm" className="flex-1" onClick={onTopUp}>
              Top up
            </Button>
          ) : null}
          {onBilling ? (
            <Button type="button" variant="secondary" size="sm" className="flex-1" onClick={onBilling}>
              Billing
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
