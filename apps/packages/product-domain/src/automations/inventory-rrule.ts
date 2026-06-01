import { DAY_MS, HOUR_MS, ruleDateTimeParts } from "./inventory-dates";

const WEEKDAY_VALUES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;

export interface ParsedRrule {
  freq: string;
  interval: number;
  byDay: string[] | null;
  byHour: number[] | null;
  byMinute: number[] | null;
}

export function parseRrule(rrule: string | null | undefined): ParsedRrule | null {
  if (!rrule) {
    return null;
  }
  const parts = parseRruleParts(rrule);
  if (!parts?.FREQ) {
    return null;
  }
  const freq = parts.FREQ;
  if (freq !== "DAILY" && freq !== "HOURLY") {
    return null;
  }
  const interval = parsePositiveInt(parts.INTERVAL ?? "1") ?? 1;
  const byHour = parts.BYHOUR ? parsePositiveIntList(parts.BYHOUR) : null;
  const byMinute = parts.BYMINUTE ? parsePositiveIntList(parts.BYMINUTE) : null;
  if (
    (byHour !== null && byHour.some((value) => value > 23))
    || (byMinute !== null && byMinute.some((value) => value > 59))
  ) {
    return null;
  }
  return {
    freq,
    interval,
    byDay: parts.BYDAY ? parts.BYDAY.split(",").filter(isWeekdayValue) : null,
    byHour,
    byMinute,
  };
}

export function dailyRuleMatches(
  date: Date,
  parsed: ParsedRrule,
  timeZone?: string | null,
): boolean {
  const parts = ruleDateTimeParts(date, timeZone);
  const weekday = WEEKDAY_VALUES[new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay()];
  if (parsed.byDay?.length && !parsed.byDay.includes(weekday)) {
    return false;
  }
  if (parsed.interval <= 1) {
    return true;
  }
  const daysSinceAnchor = (
    Date.UTC(parts.year, parts.month - 1, parts.day)
    - Date.UTC(2020, 0, 1)
  ) / DAY_MS;
  return Number.isInteger(daysSinceAnchor) && daysSinceAnchor % parsed.interval === 0;
}

export function hourlyIntervalMatches(
  date: Date,
  interval: number,
  timeZone?: string | null,
): boolean {
  if (interval <= 1) {
    return true;
  }
  const parts = ruleDateTimeParts(date, timeZone);
  const hoursSinceAnchor = (
    Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour)
    - Date.UTC(2020, 0, 1, 0)
  ) / HOUR_MS;
  return Number.isInteger(hoursSinceAnchor) && hoursSinceAnchor % interval === 0;
}

function parseRruleParts(rrule: string): Record<string, string> | null {
  const line = rrule.trim().toUpperCase().replace(/^RRULE:/, "");
  if (!line) {
    return null;
  }
  const parts: Record<string, string> = {};
  for (const segment of line.split(";")) {
    const [key, ...valueParts] = segment.split("=");
    const value = valueParts.join("=");
    if (!key || !value) {
      return null;
    }
    parts[key] = value;
  }
  return parts;
}

function isWeekdayValue(value: string): value is typeof WEEKDAY_VALUES[number] {
  return (WEEKDAY_VALUES as readonly string[]).includes(value);
}

function parsePositiveInt(value: string): number | null {
  if (!/^\d+$/.test(value)) {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parsePositiveIntList(value: string): number[] | null {
  const values = value.split(",").map((part) => parsePositiveInt(part));
  if (values.length === 0 || values.some((part) => part === null)) {
    return null;
  }
  return [...new Set(values as number[])].sort((left, right) => left - right);
}
