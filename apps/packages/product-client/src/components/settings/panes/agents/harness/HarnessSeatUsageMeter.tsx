import type { SeatUsageSample } from "@proliferate/cloud-sdk";
import { ProgressBar } from "#product/primitives/ProgressBar";
import { HARNESS_PANE_COPY } from "#product/copy/settings/harness-pane";

/**
 * Per-seat 5h/7d usage meters (agent_auth spec flow 5's soft signal — slice
 * 4, meters). Renders one seat's latest usage-probe sample: two utilization
 * bars with reset times, the binding window emphasized, warning treatment at
 * >= 75%. Honest empty/failed states per the delivery spec: no sample yet or
 * a `probe_failed` sample renders a dash and the sample age — never a stale
 * bar pretending to be live. Advisory only; nothing here gates anything.
 */

const WARNING_THRESHOLD = 0.75;

function formatResetTime(iso: string | null | undefined, now: Date): string | null {
  if (!iso) return null;
  const reset = new Date(iso);
  if (Number.isNaN(reset.getTime())) return null;
  // A reset already behind us would read as a future time — say nothing and
  // let the sample age carry the staleness instead.
  if (reset.getTime() <= now.getTime()) return null;
  const sameDay =
    reset.getTime() - now.getTime() < 24 * 60 * 60 * 1000 &&
    reset.getDate() === now.getDate();
  const time = reset.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (sameDay) return time;
  return `${reset.toLocaleDateString([], { weekday: "short" })} ${time}`;
}

function formatAge(iso: string, now: Date): string {
  const sampled = new Date(iso);
  if (Number.isNaN(sampled.getTime())) return "";
  const minutes = Math.max(0, Math.round((now.getTime() - sampled.getTime()) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function UsageBar({
  label,
  utilization,
  resetIso,
  binding,
  limited,
  now,
}: {
  label: string;
  utilization: number;
  resetIso: string | null | undefined;
  binding: boolean;
  limited: boolean;
  now: Date;
}) {
  const percent = Math.round(Math.min(Math.max(utilization, 0), 1) * 100);
  // Judge the ROUNDED percent so the label and its treatment always agree
  // (0.745 renders "75%" and must warn like 75%).
  const warning = limited || percent >= WARNING_THRESHOLD * 100;
  const reset = formatResetTime(resetIso, now);
  return (
    <div
      className="flex items-center gap-2"
      data-seat-usage-window={binding ? "binding" : "secondary"}
      data-seat-usage-warning={warning ? "true" : undefined}
    >
      <span
        className={
          binding
            ? "w-12 shrink-0 text-ui-sm font-medium text-foreground"
            : "w-12 shrink-0 text-ui-sm text-muted-foreground"
        }
      >
        {label}
      </span>
      <ProgressBar
        value={percent}
        className="block h-1 w-24 shrink-0 overflow-hidden rounded-full bg-surface-control"
        indicatorClassName={
          warning
            ? "block h-full rounded-full bg-warning-foreground"
            : "block h-full rounded-full bg-foreground/40"
        }
        aria-label={`${label} usage`}
      />
      <span
        className={
          warning
            ? "text-ui-sm text-warning-foreground"
            : "text-ui-sm text-muted-foreground"
        }
      >
        {HARNESS_PANE_COPY.seatUsagePercent(percent)}
      </span>
      {limited ? (
        <span className="text-ui-sm text-warning-foreground">
          {HARNESS_PANE_COPY.seatUsageLimited}
        </span>
      ) : null}
      {reset ? (
        <span className="truncate text-ui-sm text-muted-foreground">
          {HARNESS_PANE_COPY.seatUsageResets(reset)}
        </span>
      ) : null}
    </div>
  );
}

export function SeatUsageMeter({
  sample,
  now = new Date(),
}: {
  sample: SeatUsageSample | undefined;
  /** Injectable clock for tests; defaults to render time. */
  now?: Date;
}) {
  if (!sample) {
    return (
      <span className="text-ui-sm text-muted-foreground" data-seat-usage-empty>
        {HARNESS_PANE_COPY.seatUsageNoSample}
      </span>
    );
  }
  if (sample.status === "probe_failed" || sample.util5h == null || sample.util7d == null) {
    return (
      <span className="text-ui-sm text-muted-foreground" data-seat-usage-failed>
        {"— "}
        {HARNESS_PANE_COPY.seatUsageProbeFailed}
        {" · "}
        {HARNESS_PANE_COPY.seatUsageCheckedAgo(formatAge(sample.sampledAt, now))}
      </span>
    );
  }
  // Emphasize the provider's binding window; with no claim recorded, neither
  // row is emphasized (no invented emphasis).
  const limited = sample.status === "limited";
  return (
    <div className="flex flex-col gap-1.5" data-seat-usage-meter>
      <UsageBar
        label={HARNESS_PANE_COPY.seatUsageFiveHourLabel}
        utilization={sample.util5h}
        resetIso={sample.reset5h}
        binding={sample.bindingWindow === "five_hour"}
        limited={limited && sample.bindingWindow !== "seven_day"}
        now={now}
      />
      <UsageBar
        label={HARNESS_PANE_COPY.seatUsageSevenDayLabel}
        utilization={sample.util7d}
        resetIso={sample.reset7d}
        binding={sample.bindingWindow === "seven_day"}
        limited={limited && sample.bindingWindow !== "five_hour"}
        now={now}
      />
      {/* Live bars carry their evidence age too — an hours-old "allowed"
          sample must never read as a fresh bar. */}
      <span className="text-ui-sm text-muted-foreground" data-seat-usage-age>
        {HARNESS_PANE_COPY.seatUsageCheckedAgo(formatAge(sample.sampledAt, now))}
      </span>
    </div>
  );
}
