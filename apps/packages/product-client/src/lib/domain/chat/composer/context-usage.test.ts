import { describe, expect, it } from "vitest";
import {
  formatCompactTokenCount,
  formatUsageCost,
  isContextUsageDestructive,
  parseUsageCost,
} from "#product/lib/domain/chat/composer/context-usage";

describe("formatCompactTokenCount", () => {
  it("formats sub-1000 values as bare integers", () => {
    expect(formatCompactTokenCount(985)).toBe("985");
    expect(formatCompactTokenCount(0)).toBe("0");
  });

  it("formats thousands with one decimal", () => {
    expect(formatCompactTokenCount(33100)).toBe("33.1k");
    expect(formatCompactTokenCount(300000)).toBe("300.0k");
  });

  it("formats millions with one decimal", () => {
    expect(formatCompactTokenCount(1000000)).toBe("1.0M");
    expect(formatCompactTokenCount(2560000)).toBe("2.6M");
  });
});

describe("isContextUsageDestructive", () => {
  it("stays neutral below 90% of the session's context budget", () => {
    expect(isContextUsageDestructive(0.899)).toBe(false);
  });

  it("turns destructive at 90% and above", () => {
    expect(isContextUsageDestructive(0.9)).toBe(true);
    expect(isContextUsageDestructive(1)).toBe(true);
  });
});

describe("parseUsageCost", () => {
  it("parses a well-formed amount/currency pair", () => {
    expect(parseUsageCost({ amount: 0.11003595, currency: "USD" }))
      .toEqual({ amount: 0.11003595, currency: "USD" });
  });

  it("rejects null, non-object, and shape-mismatched cost payloads", () => {
    expect(parseUsageCost(null)).toBeNull();
    expect(parseUsageCost(undefined)).toBeNull();
    expect(parseUsageCost("0.11")).toBeNull();
    expect(parseUsageCost({ amount: "0.11", currency: "USD" })).toBeNull();
    expect(parseUsageCost({ amount: 0.11, currency: 1 })).toBeNull();
    expect(parseUsageCost({ amount: 0.11, currency: "US" })).toBeNull();
    expect(parseUsageCost({ amount: Number.NaN, currency: "USD" })).toBeNull();
  });
});

describe("formatUsageCost", () => {
  it("renders a localized currency amount", () => {
    expect(formatUsageCost({ amount: 0.11003595, currency: "USD" })).toBe("$0.11");
  });
});
