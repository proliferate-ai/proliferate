import type { SupportSnapshotPreparation } from "@proliferate/product-client/host/desktop-bridge";
import { isSupportIdentity } from "#product/lib/domain/support/support-session-contract";

const MAX_WINDOW_NANOSECONDS = 900_000_000_000n;
const NANOSECONDS_PER_MILLISECOND = 1_000_000n;
const NANOSECONDS_PER_SECOND = 1_000_000_000n;
const RFC3339_UTC =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|\+00:00)$/;

export interface SupportUtcInstant {
  nanoseconds: bigint;
}

export function exactIdentity(input: unknown, key: string): string | null {
  const value = ownData(input, key);
  return typeof value === "string" && isExactIdentityValue(value) ? value : null;
}

export function isExactIdentityValue(value: string): boolean {
  return isSupportIdentity(value);
}

export function ownUtcTimestamp(input: unknown, key: string): string | null {
  const value = ownData(input, key);
  return typeof value === "string" && parseSupportUtcTimestamp(value) !== null ? value : null;
}

export function ownSafeNonnegativeInteger(input: unknown, key: string): number | null {
  const value = ownData(input, key);
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= 0
    && !Object.is(value, -0)
    ? value
    : null;
}

export function hasSafeOwnDataShape(input: unknown): input is object {
  if (input === null || typeof input !== "object") return false;
  try {
    if (Array.isArray(input) || Object.getPrototypeOf(input) !== Object.prototype) return false;
    if (Object.getOwnPropertySymbols(input).length !== 0) return false;
    return Object.getOwnPropertyNames(input).every((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      return Boolean(descriptor && "value" in descriptor && descriptor.enumerable);
    });
  } catch {
    return false;
  }
}

export function inTimestampWindow(candidate: string, lower: string, upper: string): boolean {
  const candidateInstant = parseSupportUtcTimestamp(candidate);
  const lowerInstant = parseCanonicalSupportTimestamp(lower);
  const upperInstant = parseCanonicalSupportTimestamp(upper);
  return candidateInstant !== null
    && lowerInstant !== null
    && upperInstant !== null
    && compareSupportInstants(candidateInstant, lowerInstant) >= 0
    && compareSupportInstants(candidateInstant, upperInstant) <= 0;
}

export function timestampNotAfter(candidate: string, upper: string): boolean {
  const candidateInstant = parseSupportUtcTimestamp(candidate);
  const upperInstant = parseCanonicalSupportTimestamp(upper);
  return candidateInstant !== null
    && upperInstant !== null
    && compareSupportInstants(candidateInstant, upperInstant) <= 0;
}

export function validPreparationWindow(preparation: SupportSnapshotPreparation): boolean {
  const captured = parseCanonicalSupportTimestamp(preparation.capturedAt);
  const lower = parseCanonicalSupportTimestamp(preparation.window.sourceTimeFrom);
  const upper = parseCanonicalSupportTimestamp(preparation.window.sourceTimeTo);
  return captured !== null
    && lower !== null
    && upper !== null
    && preparation.capturedAt === preparation.window.sourceTimeTo
    && isExactFifteenMinuteWindow(lower, upper)
    && compareSupportInstants(captured, upper) === 0;
}

export function timestampInstant(value: string): SupportUtcInstant | null {
  return parseSupportUtcTimestamp(value);
}

export function parseCanonicalSupportTimestamp(value: string): SupportUtcInstant | null {
  return parseSupportTimestamp(value, false);
}

export function compareSupportInstants(
  left: SupportUtcInstant,
  right: SupportUtcInstant,
): number {
  return left.nanoseconds === right.nanoseconds
    ? 0
    : left.nanoseconds < right.nanoseconds
      ? -1
      : 1;
}

export function supportInstantFromEpochMilliseconds(milliseconds: number): SupportUtcInstant {
  if (!Number.isSafeInteger(milliseconds)) throw new TypeError("Invalid clock value");
  return { nanoseconds: BigInt(milliseconds) * NANOSECONDS_PER_MILLISECOND };
}

export function supportInstantToTimestamp(instant: SupportUtcInstant): string {
  const epochMilliseconds = instant.nanoseconds / NANOSECONDS_PER_MILLISECOND;
  if (epochMilliseconds < -8_640_000_000_000_000n
    || epochMilliseconds > 8_640_000_000_000_000n) {
    throw new RangeError("Invalid support timestamp instant");
  }
  const subsecond = ((instant.nanoseconds % NANOSECONDS_PER_SECOND)
    + NANOSECONDS_PER_SECOND) % NANOSECONDS_PER_SECOND;
  const fraction = subsecond.toString().padStart(9, "0");
  const seconds = new Date(Number(epochMilliseconds)).toISOString().replace(/\.\d{3}Z$/, "");
  return `${seconds}.${fraction}Z`;
}

export function addSupportSeconds(
  instant: SupportUtcInstant,
  seconds: number,
): SupportUtcInstant {
  if (!Number.isSafeInteger(seconds)) throw new TypeError("Invalid duration");
  return { nanoseconds: instant.nanoseconds + BigInt(seconds) * NANOSECONDS_PER_SECOND };
}

export function supportDeadlineDelayMilliseconds(
  now: SupportUtcInstant,
  deadline: SupportUtcInstant,
): number {
  const remaining = deadline.nanoseconds - now.nanoseconds;
  return remaining <= 0n
    ? 0
    : Number((remaining + NANOSECONDS_PER_MILLISECOND - 1n) / NANOSECONDS_PER_MILLISECOND);
}

function parseSupportUtcTimestamp(value: string): SupportUtcInstant | null {
  return parseSupportTimestamp(value, true);
}

function isExactFifteenMinuteWindow(
  from: SupportUtcInstant,
  to: SupportUtcInstant,
): boolean {
  return to.nanoseconds - from.nanoseconds === MAX_WINDOW_NANOSECONDS;
}

function parseSupportTimestamp(value: string, allowZeroOffset: boolean): SupportUtcInstant | null {
  const match = RFC3339_UTC.exec(value);
  if (!match || (!allowZeroOffset && match[8] !== "Z")) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (
    year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)
    || hour > 23 || minute > 59 || second > 59
  ) return null;
  const fraction = (match[7] ?? "").padEnd(9, "0");
  const seconds = daysFromCivil(year, month, day) * 86_400
    + hour * 3_600 + minute * 60 + second;
  return {
    nanoseconds: BigInt(seconds) * NANOSECONDS_PER_SECOND + BigInt(fraction || "0"),
  };
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

function ownData(input: unknown, key: string): unknown {
  if (input === null || typeof input !== "object") return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    return descriptor && "value" in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}
