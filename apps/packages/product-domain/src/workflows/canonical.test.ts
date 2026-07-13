import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import casesFixture from "../../../../../fixtures/contracts/workflow-run/canonical-cases.json";
import bundleFixture from "../../../../../fixtures/contracts/workflow-run/resolved-bundle.json";
import { canonicalJson } from "./canonical";

function sha256Hex(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

describe("canonicalJson", () => {
  it("agrees with every golden canonical case", () => {
    expect(casesFixture.cases.length).toBeGreaterThan(0);
    for (const testCase of casesFixture.cases) {
      expect(canonicalJson(testCase.value), testCase.name).toBe(testCase.canonical);
      expect(sha256Hex(testCase.value), testCase.name).toBe(testCase.sha256);
    }
  });

  it("agrees with the golden resolved-bundle digest", () => {
    expect(sha256Hex(bundleFixture.bundle)).toBe(bundleFixture.sha256);
  });

  it("renders ECMAScript number thresholds", () => {
    const cases: Array<[number, string]> = [
      [0, "0"],
      [-0, "0"],
      [1, "1"],
      [-1.5, "-1.5"],
      [1e20, "100000000000000000000"],
      [1e21, "1e+21"],
      [1e-6, "0.000001"],
      [1e-7, "1e-7"],
      [333333333.33333329, "333333333.3333333"],
      [5e-324, "5e-324"],
      [1.7976931348623157e308, "1.7976931348623157e+308"],
    ];
    for (const [value, expected] of cases) {
      expect(canonicalJson(value)).toBe(expected);
    }
  });

  it("sorts object keys by UTF-16 code units", () => {
    const value = { "דּ": 1, "\u{1F600}": 2, "€": 3, "1": 4, "\r": 5 };
    expect(canonicalJson(value)).toBe(
      '{"\\r":5,"1":4,"€":3,"\u{1F600}":2,"דּ":1}',
    );
  });

  it("rejects non-finite numbers and non-JSON types", () => {
    expect(() => canonicalJson(Number.NaN)).toThrow();
    expect(() => canonicalJson(Number.POSITIVE_INFINITY)).toThrow();
    expect(() => canonicalJson(undefined)).toThrow();
    expect(() => canonicalJson(() => null)).toThrow();
  });

  it("canonicalizes u64-overflowing integer literals as their parsed double, matching Rust", () => {
    // JSON.parse has already rounded these; the Rust twin's serde_json does
    // the same for literals beyond u64/i64 and must emit identical bytes.
    // The Python twin rejects them at the Cloud write boundary.
    const cases: Array<[string, string]> = [
      ["18446744073709551616", "18446744073709552000"],
      ["100000000000000000001", "100000000000000000000"],
      ["-9223372036854775809", "-9223372036854776000"],
    ];
    for (const [literal, expected] of cases) {
      expect(canonicalJson(JSON.parse(literal))).toBe(expected);
    }
  });

  it("rejects strings containing lone surrogates", () => {
    expect(() => canonicalJson("\uD800")).toThrow(/lone surrogates/);
    expect(() => canonicalJson({ "\uDC00": 1 })).toThrow(/lone surrogates/);
    expect(() => canonicalJson(["a\uD800b"])).toThrow(/lone surrogates/);
    // Well-formed pairs must keep passing.
    expect(canonicalJson("\u{1F600}")).toBe('"\u{1F600}"');
  });
});
