import { forwardRef, type ButtonHTMLAttributes } from "react";
import type { UsageSummary } from "@proliferate/cloud-sdk";
import { Button } from "@proliferate/ui/primitives/Button";

type ConsumptionMeterTone = "default" | "warning" | "destructive";

type ConsumptionMeterKind =
  | "unlimited"
  | "available"
  | "blocked"
  | "zero-allocation"
  | "exhausted";

interface ConsumptionMeterState {
  kind: ConsumptionMeterKind;
  percent: number | null;
  tone: ConsumptionMeterTone;
  blocked: boolean;
}

export type SidebarConsumptionState =
  | { kind: "loading" }
  | { kind: "unavailable"; message: string }
  | { kind: "ready"; usageSummary: UsageSummary };

export type SidebarConsumptionMeter = "compute" | "llm";

export type SidebarConsumptionActions =
  | { kind: "billing"; onBilling: () => void }
  | { kind: "admin-managed"; message: string; onBilling: () => void }
  | { kind: "unavailable"; message: string };

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
  if (limit) {
    if (limit.capValue <= 0) {
      return limit.usedValue > 0
        ? { kind: "exhausted", percent: 100, tone: "destructive", blocked: limit.blocked }
        : { kind: "zero-allocation", percent: 100, tone: "destructive", blocked: limit.blocked };
    }
    if (limit.blocked) {
      return limit.usedValue > 0
        ? { kind: "exhausted", percent: 100, tone: "destructive", blocked: true }
        : { kind: "blocked", percent: 100, tone: "destructive", blocked: true };
    }
    const percent = Math.min(100, (limit.usedValue / limit.capValue) * 100);
    return {
      kind: "available",
      percent,
      tone: percent >= CONSUMPTION_NEAR_LIMIT_PERCENT ? "warning" : "default",
      blocked: false,
    };
  }

  if (remainingValue === null) {
    return { kind: "unlimited", percent: null, tone: "default", blocked: false };
  }

  if (remainingValue <= 0) {
    return usedValue > 0
      ? { kind: "exhausted", percent: 100, tone: "destructive", blocked: false }
      : { kind: "zero-allocation", percent: 100, tone: "destructive", blocked: false };
  }

  const total = usedValue + remainingValue;
  const percent = Math.min(100, (usedValue / total) * 100);
  return {
    kind: "available",
    percent,
    tone: percent >= CONSUMPTION_NEAR_LIMIT_PERCENT ? "warning" : "default",
    blocked: false,
  };
}

function consumptionMeterAriaStatus(state: ConsumptionMeterState): string {
  switch (state.kind) {
    case "zero-allocation":
      return "No allocation";
    case "exhausted":
      return `100% used, exhausted${state.blocked ? ", blocked" : ""}`;
    case "blocked":
      return "blocked";
    case "unlimited":
      return "unlimited";
    case "available":
      return `${Math.round(state.percent ?? 0)}% used`;
  }
}

function consumptionMeterDetailLabel(state: ConsumptionMeterState): string {
  switch (state.kind) {
    case "zero-allocation":
      return "No allocation";
    case "exhausted":
      return `100% used · Exhausted${state.blocked ? " · Blocked" : ""}`;
    case "blocked":
      return "Blocked";
    case "unlimited":
      return "No limit";
    case "available":
      return `${Math.round(state.percent ?? 0)}% used`;
  }
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
  const statusLabel = state.kind === "loading"
    ? "loading"
    : state.kind === "unavailable"
      ? "unavailable"
      : consumptionMeterAriaStatus(meters![meter]);
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
  const usedLabel = consumptionMeterDetailLabel(state);
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
  actions,
}: {
  state: SidebarConsumptionState;
  onRetry?: () => void;
  actions?: SidebarConsumptionActions;
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
  const blocked = meters.compute.kind === "blocked"
    || meters.compute.kind === "zero-allocation"
    || meters.compute.kind === "exhausted"
    || meters.llm.kind === "blocked"
    || meters.llm.kind === "zero-allocation"
    || meters.llm.kind === "exhausted";

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
      {blocked && actions?.kind === "admin-managed" ? (
        <div className="px-2.5 py-1.5 text-ui-sm text-destructive">
          Ask your admin to raise your limit.
        </div>
      ) : null}
      {!blocked && actions?.kind === "admin-managed" ? (
        <div className="px-2.5 py-1.5 text-ui-sm text-sidebar-muted-foreground">
          {actions.message}
        </div>
      ) : null}
      {actions?.kind === "unavailable" ? (
        <div className="px-2.5 py-1.5 text-ui-sm text-sidebar-muted-foreground">
          {actions.message}
        </div>
      ) : null}
      {actions?.kind === "billing" || actions?.kind === "admin-managed" ? (
        <div className="mt-1 flex gap-2 border-t border-border-light px-2 py-2">
          <Button type="button" variant="secondary" size="sm" className="flex-1" onClick={actions.onBilling}>
            Billing
          </Button>
        </div>
      ) : null}
    </div>
  );
}
