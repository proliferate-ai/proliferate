import type { ErrorEventDetails } from "@anyharness/sdk";

/**
 * The `seat_usage_limit` turn-error details (agent_auth spec flow 5, the hard
 * signal): a session died because its Claude.ai seat hit a plan limit.
 *
 * THE ONE LOCAL TYPE EXTENSION for this contract: the Rust runtime ships this
 * `ErrorEventDetails` variant in the same slice, so the generated SDK union
 * does not carry it yet — the reader below feature-detects by string value,
 * the same defensive move the `network_connection` arm makes in
 * `session-error-presentation.ts`. Field casing mirrors the existing
 * `provider_rate_limit` details convention (camelCase fields, snake_case enum
 * values). Fold into the generated union and delete this once the SDK regen
 * carries the variant.
 */
export interface SeatUsageLimitErrorDetails {
  kind: "seat_usage_limit";
  /** The vault entry id of the seat that hit its limit — never key material. */
  seatId: string;
  /**
   * Which usage window bound, when the provider error named one. Quoted
   * everywhere in this src/domain tree: it is the contract's data key
   * (mirrors `seat_usage_sample.binding_window`), not the browser global
   * FE-PC-4 forbids.
   */
  "window": "five_hour" | "seven_day" | null;
  /** RFC3339 UTC instant the binding window resets. */
  resetAt: string;
}

/**
 * Narrow error-event details to the seat-limit shape, or null. Tolerant on
 * purpose: a malformed variant (missing seat id or reset) reads as "not this
 * kind" and falls through to the generic error presentation rather than
 * rendering a half-filled arm.
 */
export function readSeatUsageLimitDetails(
  details: ErrorEventDetails | null | undefined,
): SeatUsageLimitErrorDetails | null {
  const record = details as {
    kind?: unknown;
    seatId?: unknown;
    "window"?: unknown;
    resetAt?: unknown;
  } | null | undefined;
  if (!record || record.kind !== "seat_usage_limit") {
    return null;
  }
  const seatId = typeof record.seatId === "string" && record.seatId.length > 0
    ? record.seatId
    : null;
  const resetAt = typeof record.resetAt === "string" && record.resetAt.length > 0
    ? record.resetAt
    : null;
  if (seatId === null || resetAt === null) {
    return null;
  }
  const raw = record["window"];
  const bindingWindow = raw === "five_hour" || raw === "seven_day" ? raw : null;
  return { kind: "seat_usage_limit", seatId, "window": bindingWindow, resetAt };
}

/**
 * The localized reset instant for human copy — "6:05 PM" when the reset lands
 * today, "6:05 PM on Aug 27" otherwise (the drop-what's-redundant move of
 * `formatWorkflowUpdatedAt`). Null when the timestamp does not parse, so
 * callers compose copy without a garbage clause instead of printing one.
 */
export function formatSeatResetTime(
  resetAt: string,
  now: Date = new Date(),
): string | null {
  const date = new Date(resetAt);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const time = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
  const sameDay = date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate();
  if (sameDay) {
    return time;
  }
  const day = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(date);
  return `${time} on ${day}`;
}
