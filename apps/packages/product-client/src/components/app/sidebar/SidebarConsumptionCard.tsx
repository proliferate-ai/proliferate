import type { UsageSummary } from "@proliferate/cloud-sdk";
import { Button } from "#product/primitives/Button";

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

const CONSUMPTION_METER_TEXT_CLASS: Record<ConsumptionMeterTone, string> = {
  default: "text-sidebar-foreground",
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

/**
 * One usage line: what the meter is, how far into it you are, and what is
 * left. Consumption used to be drawn as two concentric rings on a dedicated
 * footer trigger, which spent a whole control slot on a shape nobody can read
 * a number off. The same three facts fit on one text row, so they read as
 * ordinary status inside the account menu instead of a chart.
 */
function ConsumptionDetailRow({
  label,
  state,
  remainingLabel,
}: {
  label: string;
  state: ConsumptionMeterState;
  remainingLabel: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-2.5 py-1">
      <span className="text-ui-sm text-sidebar-muted-foreground">{label}</span>
      <span className="flex min-w-0 items-baseline gap-1.5 text-ui-sm">
        <span className={CONSUMPTION_METER_TEXT_CLASS[state.tone]}>
          {consumptionMeterDetailLabel(state)}
        </span>
        <span className="truncate text-faint">{remainingLabel}</span>
      </span>
    </div>
  );
}

/** Usage/consumption status rows, hosted inline by the account menu. */
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
      <div className="px-2.5 py-1.5 text-ui-sm text-sidebar-muted-foreground" role="status">
        Loading usage…
      </div>
    );
  }

  if (state.kind === "unavailable") {
    return (
      <div className="space-y-1.5 px-2.5 py-1.5">
        <div className="text-ui-sm text-sidebar-foreground">Usage unavailable</div>
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
    <div>
      <div className="px-2.5 pb-0.5 pt-1 text-ui-sm text-faint">Usage</div>
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
        <div className="px-2.5 py-1 text-ui-sm text-destructive">
          Ask your admin to raise your limit.
        </div>
      ) : null}
      {!blocked && actions?.kind === "admin-managed" ? (
        <div className="px-2.5 py-1 text-ui-sm text-sidebar-muted-foreground">
          {actions.message}
        </div>
      ) : null}
      {actions?.kind === "unavailable" ? (
        <div className="px-2.5 py-1 text-ui-sm text-sidebar-muted-foreground">
          {actions.message}
        </div>
      ) : null}
      {actions?.kind === "billing" || actions?.kind === "admin-managed" ? (
        <div className="px-2 pb-1 pt-1.5">
          <Button type="button" variant="secondary" size="sm" className="w-full" onClick={actions.onBilling}>
            Billing
          </Button>
        </div>
      ) : null}
    </div>
  );
}
