import { describe, expect, it } from "vitest";
import type { ErrorEventDetails } from "@anyharness/sdk";
import {
  formatSeatResetTime,
  readSeatUsageLimitDetails,
} from "./seat-usage-limit";

describe("readSeatUsageLimitDetails", () => {
  it("narrows the seat_usage_limit variant with its camelCase fields", () => {
    const details = {
      kind: "seat_usage_limit",
      seatId: "seat-1",
      "window": "five_hour",
      resetAt: "2026-08-27T18:00:00Z",
    } as unknown as ErrorEventDetails;

    expect(readSeatUsageLimitDetails(details)).toEqual({
      kind: "seat_usage_limit",
      seatId: "seat-1",
      "window": "five_hour",
      resetAt: "2026-08-27T18:00:00Z",
    });
  });

  it("tolerates an absent or unknown window as null", () => {
    const details = {
      kind: "seat_usage_limit",
      seatId: "seat-1",
      resetAt: "2026-08-27T18:00:00Z",
    } as unknown as ErrorEventDetails;

    expect(readSeatUsageLimitDetails(details)?.["window"]).toBeNull();
  });

  it("rejects other kinds, null, and malformed variants", () => {
    expect(readSeatUsageLimitDetails(null)).toBeNull();
    expect(readSeatUsageLimitDetails(undefined)).toBeNull();
    expect(
      readSeatUsageLimitDetails({
        kind: "provider_rate_limit",
        provider: "anthropic",
        providerModel: "claude-opus-4-7",
        limit: 1,
        unit: "tokens",
        fallbackModelId: "claude-opus-4-6",
      }),
    ).toBeNull();
    // Missing seatId / resetAt reads as "not this kind" — the generic error
    // presentation handles it rather than a half-filled arm.
    expect(
      readSeatUsageLimitDetails({
        kind: "seat_usage_limit",
        resetAt: "2026-08-27T18:00:00Z",
      } as unknown as ErrorEventDetails),
    ).toBeNull();
    expect(
      readSeatUsageLimitDetails({
        kind: "seat_usage_limit",
        seatId: "seat-1",
      } as unknown as ErrorEventDetails),
    ).toBeNull();
  });
});

describe("formatSeatResetTime", () => {
  const timeOf = (iso: string) =>
    new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" })
      .format(new Date(iso));

  it("renders time only when the reset lands today", () => {
    const resetAt = "2026-08-27T18:05:00Z";
    const now = new Date("2026-08-27T15:00:00Z");
    // Guard against a timezone where 18:05Z crosses midnight relative to now:
    // pick the same calendar day in local time before asserting the shape.
    const sameLocalDay =
      new Date(resetAt).getDate() === now.getDate()
      && new Date(resetAt).getMonth() === now.getMonth();
    const formatted = formatSeatResetTime(resetAt, now);
    if (sameLocalDay) {
      expect(formatted).toBe(timeOf(resetAt));
    } else {
      expect(formatted).toContain(timeOf(resetAt));
    }
  });

  it("appends the day when the reset lands on another day", () => {
    const resetAt = "2026-08-30T18:05:00Z";
    const formatted = formatSeatResetTime(resetAt, new Date("2026-08-27T15:00:00Z"));
    const day = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" })
      .format(new Date(resetAt));
    expect(formatted).toBe(`${timeOf(resetAt)} on ${day}`);
  });

  it("returns null for an unparseable instant", () => {
    expect(formatSeatResetTime("not-a-date")).toBeNull();
  });
});
