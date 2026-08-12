import type { SupportSnapshotPreparation } from "@proliferate/product-client/host/desktop-bridge";

const MAX_IDENTITY_BYTES = 128;
const MAX_WINDOW_MS = 15 * 60 * 1_000;
const UTC_RFC3339 = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?Z$/;

export function exactIdentity(input: unknown, key: string): string | null {
  const value = ownData(input, key);
  return typeof value === "string" && isExactIdentityValue(value) ? value : null;
}

export function isExactIdentityValue(value: string): boolean {
  return value.length > 0
    && value === value.trim()
    && isWellFormedUnicode(value)
    && !/[\u0000-\u001f\u007f]/.test(value)
    && new TextEncoder().encode(value).length <= MAX_IDENTITY_BYTES;
}

export function ownUtcTimestamp(input: unknown, key: string): string | null {
  const value = ownData(input, key);
  return typeof value === "string" && isUtcTimestamp(value) ? value : null;
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
  const candidateMs = Date.parse(candidate);
  const lowerMs = Date.parse(lower);
  const upperMs = Date.parse(upper);
  return isUtcTimestamp(candidate)
    && isUtcTimestamp(lower)
    && isUtcTimestamp(upper)
    && candidateMs >= lowerMs
    && candidateMs <= upperMs;
}

export function timestampNotAfter(candidate: string, upper: string): boolean {
  return isUtcTimestamp(candidate)
    && isUtcTimestamp(upper)
    && Date.parse(candidate) <= Date.parse(upper);
}

export function validPreparationWindow(preparation: SupportSnapshotPreparation): boolean {
  const captured = Date.parse(preparation.capturedAt);
  const lower = Date.parse(preparation.window.sourceTimeFrom);
  const upper = Date.parse(preparation.window.sourceTimeTo);
  return isUtcTimestamp(preparation.capturedAt)
    && isUtcTimestamp(preparation.window.sourceTimeFrom)
    && isUtcTimestamp(preparation.window.sourceTimeTo)
    && preparation.capturedAt === preparation.window.sourceTimeTo
    && upper - lower === MAX_WINDOW_MS
    && captured === upper;
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

function isUtcTimestamp(value: string): boolean {
  const match = UTC_RFC3339.exec(value);
  if (!match) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return year >= 1
    && month >= 1
    && month <= 12
    && day >= 1
    && day <= daysInMonth
    && hour < 24
    && minute < 60
    && second < 60
    && Number.isFinite(Date.parse(value));
}

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return false;
  }
  return true;
}
