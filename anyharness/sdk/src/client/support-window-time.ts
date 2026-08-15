const MAX_WINDOW_NANOSECONDS = 900_000_000_000n;
const UTC_RFC3339 =
  /^(\d{4})-(\d{2})-(\d{2})[Tt ](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?([Zz]|\+00:00|-00:00)$/;

interface ParsedTimestamp {
  canonical: string;
  nanoseconds: bigint;
}

export function normalizeSupportWindowTimestamp(value: string): string {
  return parseUtcTimestamp(value).canonical;
}

export function validateSupportWindowTimeRange(from: string, to: string): void {
  const fromTimestamp = parseUtcTimestamp(from);
  const toTimestamp = parseUtcTimestamp(to);
  if (fromTimestamp.nanoseconds > toTimestamp.nanoseconds) {
    throw invalidTimestamp("timestamp window is inverted");
  }
  if (
    toTimestamp.nanoseconds - fromTimestamp.nanoseconds
    > MAX_WINDOW_NANOSECONDS
  ) {
    throw invalidTimestamp("timestamp window exceeds fifteen minutes");
  }
}

function parseUtcTimestamp(value: string): ParsedTimestamp {
  if (value.length > 4_096) {
    throw invalidTimestamp("timestamp must be UTC RFC3339");
  }
  const match = UTC_RFC3339.exec(value);
  if (!match || match[8] === "-00:00") {
    throw invalidTimestamp("timestamp must be UTC RFC3339");
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (
    month < 1 || month > 12
    || day < 1 || day > daysInMonth(year, month)
    || hour > 23 || minute > 59 || second > 60
  ) {
    throw invalidTimestamp("timestamp is not a valid UTC instant");
  }
  const fraction = (match[7] ?? "").slice(0, 9).padEnd(9, "0");
  const days = daysFromCivil(year, month, day);
  const baseSecond = second === 60 ? 59 : second;
  const leapNanoseconds = second === 60 ? 1_000_000_000n : 0n;
  const seconds = days * 86_400 + hour * 3_600 + minute * 60 + baseSecond;
  return {
    canonical: canonicalTimestamp(match, fraction),
    nanoseconds: BigInt(seconds) * 1_000_000_000n
      + leapNanoseconds + BigInt(fraction || "0"),
  };
}

function canonicalTimestamp(match: RegExpExecArray, fraction: string): string {
  let precision = 0;
  if (fraction !== "000000000") {
    precision = fraction.endsWith("000000") ? 3 : fraction.endsWith("000") ? 6 : 9;
  }
  const base = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}`;
  return precision === 0 ? `${base}Z` : `${base}.${fraction.slice(0, precision)}Z`;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function daysFromCivil(year: number, month: number, day: number): number {
  const adjustedYear = year - (month <= 2 ? 1 : 0);
  const era = Math.floor(adjustedYear / 400);
  const yearOfEra = adjustedYear - era * 400;
  const adjustedMonth = month + (month > 2 ? -3 : 9);
  const dayOfYear = Math.floor((153 * adjustedMonth + 2) / 5) + day - 1;
  const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4)
    - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146_097 + dayOfEra - 719_468;
}

function invalidTimestamp(message: string): TypeError {
  return new TypeError(`Invalid support-window options: ${message}`);
}
