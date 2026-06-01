export const DAY_MS = 24 * 60 * 60 * 1000;
export const HOUR_MS = 60 * 60 * 1000;

export function normalizeDate(value?: Date | number): Date {
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === "number") {
    return new Date(value);
  }
  return new Date();
}

export function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function localDateId(date: Date): string {
  const year = date.getFullYear().toString().padStart(4, "0");
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const day = date.getDate().toString().padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function addLocalDays(date: Date, days: number): Date {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() + days,
    date.getHours(),
    date.getMinutes(),
    date.getSeconds(),
    date.getMilliseconds(),
  );
}

export function formatNextRunLabel(
  value: string | null,
  timezone: string | null | undefined,
  now: Date,
): string {
  if (!value) {
    return "Not scheduled";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }
  const deltaMs = date.getTime() - now.getTime();
  if (deltaMs >= 0 && deltaMs < 60 * 1000) {
    return "Due now";
  }
  if (deltaMs >= 0 && deltaMs < 60 * 60 * 1000) {
    const minutes = Math.max(1, Math.round(deltaMs / (60 * 1000)));
    return minutes === 1 ? "in 1 minute" : `in ${minutes} minutes`;
  }
  return formatTimestamp(value, timezone);
}

export function formatTimestamp(value: string | null | undefined, timezone?: string | null): string {
  if (!value) {
    return "Unknown";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timezone ?? undefined,
  }).format(date);
}

export function formatTimeOnly(date: Date, timezone?: string | null): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone ?? undefined,
  }).format(date);
}

export function compactMessage(message: string): string {
  const firstLine = message.split(/\r?\n/)[0]?.trim() ?? "";
  if (firstLine.length <= 140) {
    return firstLine;
  }
  return `${firstLine.slice(0, 137)}...`;
}

export function ruleDateTimeParts(date: Date, timeZone?: string | null) {
  if (timeZone) {
    return dateTimePartsInZone(date, timeZone);
  }
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
    hour: date.getHours(),
    minute: date.getMinutes(),
  };
}

export function zonedDateTimeToDate(args: {
  date: string;
  hour: number;
  minute: number;
  timeZone?: string;
}): Date {
  const [year, month, day] = args.date.split("-").map((part) => Number.parseInt(part, 10));
  if (!args.timeZone) {
    return new Date(year, month - 1, day, args.hour, args.minute, 0, 0);
  }
  let candidate = new Date(Date.UTC(year, month - 1, day, args.hour, args.minute, 0, 0));
  for (let i = 0; i < 3; i += 1) {
    const parts = dateTimePartsInZone(candidate, args.timeZone);
    const desired = Date.UTC(year, month - 1, day, args.hour, args.minute, 0, 0);
    const actual = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0, 0);
    const delta = desired - actual;
    if (delta === 0) {
      return candidate;
    }
    candidate = new Date(candidate.getTime() + delta);
  }
  return candidate;
}

function dateTimePartsInZone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const value = (type: string) => Number.parseInt(parts.find((part) => part.type === type)?.value ?? "0", 10);
  const hour = value("hour");
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: hour === 24 ? 0 : hour,
    minute: value("minute"),
  };
}
