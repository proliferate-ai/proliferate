/**
 * Session loop — pure mirror of the pinned LoopPort wire contract v1
 * (anyharness-contract v1::Loop). Loops are strict mirrors of native harness
 * state where it exists (Claude session crons) and runtime-emulated
 * equivalents where it doesn't (Codex — `native: false`, the user-armed
 * product scheduler; not synthetic harness behavior). Unlike goals, multiple
 * loops per session are legal — each keyed by `loopId`, upserted independently.
 */

export type LoopScheduleKind = "interval" | "cron";

export interface LoopSchedule {
  kind: LoopScheduleKind;
  /** `"5m"` sugar for `interval`, a five-field cron expression for `cron`. */
  expr: string;
}

export const LOOP_STATUSES = ["active", "cleared"] as const;

export type LoopStatus = (typeof LOOP_STATUSES)[number];

export interface LoopWire {
  loopId: string;
  prompt: string;
  schedule: LoopSchedule;
  recurring: boolean;
  status: LoopStatus;
  native: boolean;
  lastFiredAtMs: number | null;
  fireCount: number;
  updatedAtMs: number;
}

/**
 * Per-session loop capability, projected from the harness capability
 * advertisement (`InitializeResponse._meta.anyharness.loops`). Claude only in
 * v1 as native; Codex omits `loops` entirely (runtime-emulated, not sidecar
 * native) — the UI gates on these flags only, never on a harness name.
 */
export interface LoopCapabilities {
  supported: boolean;
  native: boolean;
}

export function isLoopScheduleKind(value: unknown): value is LoopScheduleKind {
  return value === "interval" || value === "cron";
}

export function isLoopStatus(value: unknown): value is LoopStatus {
  return typeof value === "string" && (LOOP_STATUSES as readonly string[]).includes(value);
}

/**
 * Strict parse of a wire payload into a `LoopWire`. Returns null on any shape
 * violation — a malformed mirror must read as "no loop", never a fabricated
 * one.
 */
export function parseLoopWire(value: unknown): LoopWire | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.loopId !== "string" || typeof record.prompt !== "string") {
    return null;
  }
  const schedule = parseLoopSchedule(record.schedule);
  if (!schedule || !isLoopStatus(record.status)) {
    return null;
  }
  if (
    typeof record.recurring !== "boolean"
    || typeof record.native !== "boolean"
    || typeof record.fireCount !== "number"
    || typeof record.updatedAtMs !== "number"
  ) {
    return null;
  }
  const lastFiredAtMs = nullableNumber(record.lastFiredAtMs);
  if (lastFiredAtMs === undefined) {
    return null;
  }
  return {
    loopId: record.loopId,
    prompt: record.prompt,
    schedule,
    recurring: record.recurring,
    status: record.status,
    native: record.native,
    lastFiredAtMs,
    fireCount: record.fireCount,
    updatedAtMs: record.updatedAtMs,
  };
}

function parseLoopSchedule(value: unknown): LoopSchedule | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (!isLoopScheduleKind(record.kind) || typeof record.expr !== "string") {
    return null;
  }
  return { kind: record.kind, expr: record.expr };
}

function nullableNumber(value: unknown): number | null | undefined {
  if (value === null || value === undefined) {
    return null;
  }
  return typeof value === "number" ? value : undefined;
}

export function loopStatusLabel(status: LoopStatus): string {
  return status === "active" ? "Armed" : "Cleared";
}

/** Live loops sort first (most-recently-fired first), cleared ones trail. */
export function sortLoopsForDisplay(loops: readonly LoopWire[]): LoopWire[] {
  return [...loops].sort((a, b) => {
    if (a.status !== b.status) {
      return a.status === "active" ? -1 : 1;
    }
    return (b.lastFiredAtMs ?? b.updatedAtMs) - (a.lastFiredAtMs ?? a.updatedAtMs);
  });
}

// ---------------------------------------------------------------------------
// Cadence: interval sugar + a tiny cron-next util. Both are display-only —
// the harness (or the runtime's emulated scheduler) owns the real timer; this
// just projects "next fire" for the panel.
// ---------------------------------------------------------------------------

const INTERVAL_SUGAR_RE = /^(\d+)(s|m|h|d)$/;

const INTERVAL_UNIT_MS: Record<string, number> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

/** Parses `"5m"`/`"30s"`/`"2h"`/`"1d"` sugar into milliseconds; null if unrecognized. */
export function parseIntervalSugarMs(expr: string): number | null {
  const match = INTERVAL_SUGAR_RE.exec(expr.trim());
  if (!match) {
    return null;
  }
  const [, amountRaw, unit] = match;
  const amount = Number(amountRaw);
  if (amount <= 0) {
    return null;
  }
  return amount * INTERVAL_UNIT_MS[unit];
}

interface CronFieldSpec {
  match: (value: number) => boolean;
}

function parseCronField(raw: string, min: number, max: number): CronFieldSpec | null {
  const allowed = new Set<number>();
  for (const part of raw.split(",")) {
    const stepMatch = /^(\*|\d+-\d+|\d+)\/(\d+)$/.exec(part);
    if (stepMatch) {
      const [, rangePart, stepRaw] = stepMatch;
      const step = Number(stepRaw);
      if (!(step > 0)) {
        return null;
      }
      const [rangeMin, rangeMax] = rangePart === "*"
        ? [min, max]
        : (rangePart.split("-").map(Number) as [number, number]);
      for (let value = rangeMin; value <= rangeMax; value += step) {
        allowed.add(value);
      }
      continue;
    }
    if (part === "*") {
      return { match: () => true };
    }
    const rangeMatch = /^(\d+)-(\d+)$/.exec(part);
    if (rangeMatch) {
      const from = Number(rangeMatch[1]);
      const to = Number(rangeMatch[2]);
      for (let value = from; value <= to; value++) {
        allowed.add(value);
      }
      continue;
    }
    const exact = Number(part);
    if (Number.isNaN(exact) || exact < min || exact > max) {
      return null;
    }
    allowed.add(exact);
  }
  if (allowed.size === 0) {
    return null;
  }
  return { match: (value) => allowed.has(value) };
}

interface ParsedCronExpr {
  minute: CronFieldSpec;
  hour: CronFieldSpec;
  dayOfMonth: CronFieldSpec;
  month: CronFieldSpec;
  dayOfWeek: CronFieldSpec;
}

/** Parses a standard five-field cron expression; null if malformed/unsupported. */
export function parseCronExpr(expr: string): ParsedCronExpr | null {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) {
    return null;
  }
  const minute = parseCronField(fields[0], 0, 59);
  const hour = parseCronField(fields[1], 0, 23);
  const dayOfMonth = parseCronField(fields[2], 1, 31);
  const month = parseCronField(fields[3], 1, 12);
  const dayOfWeek = parseCronField(fields[4], 0, 6);
  if (!minute || !hour || !dayOfMonth || !month || !dayOfWeek) {
    return null;
  }
  return { minute, hour, dayOfMonth, month, dayOfWeek };
}

/** Bounds the brute-force minute search so a malformed/rare expr can't hang the UI. */
const CRON_SEARCH_LIMIT_MINUTES = 60 * 24 * 366;

/**
 * Tiny cron-next util: brute-force minute stepping bounded to one year out.
 * Good enough for display purposes (loop cadences are minutes-to-hours in
 * practice); not a scheduler — the harness/emulated scheduler owns firing.
 */
export function cronNextFireAtMs(expr: string, afterMs: number): number | null {
  const parsed = parseCronExpr(expr);
  if (!parsed) {
    return null;
  }
  let candidateMs = Math.ceil((afterMs + 1) / 60_000) * 60_000;
  for (let i = 0; i < CRON_SEARCH_LIMIT_MINUTES; i++) {
    const candidate = new Date(candidateMs);
    if (
      parsed.minute.match(candidate.getUTCMinutes())
      && parsed.hour.match(candidate.getUTCHours())
      && parsed.dayOfMonth.match(candidate.getUTCDate())
      && parsed.month.match(candidate.getUTCMonth() + 1)
      && parsed.dayOfWeek.match(candidate.getUTCDay())
    ) {
      return candidateMs;
    }
    candidateMs += 60_000;
  }
  return null;
}

/**
 * Next-fire projection for a loop: null when cleared or the schedule can't
 * be parsed. Anchors interval sugar off the last fire (or arm time, before
 * the first fire) so the projection tracks the real cadence, not "now".
 */
export function loopNextFireAtMs(
  loop: Pick<LoopWire, "schedule" | "status" | "lastFiredAtMs" | "updatedAtMs">,
  nowMs: number,
): number | null {
  if (loop.status !== "active") {
    return null;
  }
  const anchorMs = loop.lastFiredAtMs ?? loop.updatedAtMs;
  if (loop.schedule.kind === "interval") {
    const stepMs = parseIntervalSugarMs(loop.schedule.expr);
    if (stepMs === null) {
      return null;
    }
    if (anchorMs > nowMs) {
      return anchorMs + stepMs;
    }
    const elapsedSteps = Math.floor((nowMs - anchorMs) / stepMs) + 1;
    return anchorMs + elapsedSteps * stepMs;
  }
  return cronNextFireAtMs(loop.schedule.expr, Math.max(anchorMs, nowMs));
}

function pluralize(amount: number, unit: string): string {
  return `${amount} ${unit}${amount === 1 ? "" : "s"}`;
}

function humanizeDurationMs(ms: number): string {
  if (ms % 86_400_000 === 0) {
    return pluralize(ms / 86_400_000, "day");
  }
  if (ms % 3_600_000 === 0) {
    return pluralize(ms / 3_600_000, "hour");
  }
  if (ms % 60_000 === 0) {
    return pluralize(ms / 60_000, "minute");
  }
  return pluralize(Math.round(ms / 1_000), "second");
}

/** Human cadence label: `"every 5 minutes"`, `"every 1 hour"`, or the raw cron as a fallback. */
export function humanizeLoopCadence(schedule: LoopSchedule): string {
  if (schedule.kind === "interval") {
    const ms = parseIntervalSugarMs(schedule.expr);
    return ms === null ? schedule.expr : `every ${humanizeDurationMs(ms)}`;
  }
  if (schedule.expr === "* * * * *") {
    return "every minute";
  }
  const everyNMinutes = /^\*\/(\d+) \* \* \* \*$/.exec(schedule.expr);
  if (everyNMinutes) {
    return `every ${pluralize(Number(everyNMinutes[1]), "minute")}`;
  }
  const everyNHours = /^0 \*\/(\d+) \* \* \*$/.exec(schedule.expr);
  if (everyNHours) {
    return `every ${pluralize(Number(everyNHours[1]), "hour")}`;
  }
  return `cron ${schedule.expr}`;
}

/** Forward-looking relative label for a next-fire timestamp: `"in 2m"`, `"in 1h"`, `"due"`. */
export function relativeFutureTimeLabel(futureMs: number, nowMs: number): string {
  const deltaSeconds = Math.floor((futureMs - nowMs) / 1000);
  if (deltaSeconds <= 0) {
    return "due";
  }
  if (deltaSeconds < 60) {
    return `in ${deltaSeconds}s`;
  }
  const deltaMinutes = Math.floor(deltaSeconds / 60);
  if (deltaMinutes < 60) {
    return `in ${deltaMinutes}m`;
  }
  const deltaHours = Math.floor(deltaMinutes / 60);
  if (deltaHours < 24) {
    return `in ${deltaHours}h`;
  }
  return `in ${Math.floor(deltaHours / 24)}d`;
}
