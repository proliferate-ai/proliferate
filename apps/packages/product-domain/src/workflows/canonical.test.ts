import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import casesFixture from "../../../../../fixtures/contracts/workflow-run/canonical-cases.json";
import bundleFixture from "../../../../../fixtures/contracts/workflow-run/resolved-bundle.json";
import payloadFixture from "../../../../../fixtures/contracts/workflow-run/runtime-payload.json";
import {
  bundleDigestJson,
  canonicalJson,
  runtimePayloadDigestJson,
} from "./canonical";

function sha256Hex(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

function sha256HexOfText(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

describe("canonicalJson", () => {
  it("agrees with every golden canonical case", () => {
    expect(casesFixture.cases.length).toBeGreaterThan(0);
    for (const testCase of casesFixture.cases) {
      expect(canonicalJson(testCase.value), testCase.name).toBe(testCase.canonical);
      expect(sha256Hex(testCase.value), testCase.name).toBe(testCase.sha256);
    }
  });

  it("agrees with the golden bundle digest over only the covered members", () => {
    expect(sha256HexOfText(bundleDigestJson(bundleFixture.bundle))).toBe(
      bundleFixture.bundleDigest,
    );
    // The digest covers exactly the four §6.3 members, nothing else.
    const { definition, arguments: args, resolvedStages, resolvedPlacement } =
      bundleFixture.bundle;
    expect(
      sha256Hex({ definition, arguments: args, resolvedStages, resolvedPlacement }),
    ).toBe(bundleFixture.bundleDigest);
  });

  it("excludes the wire wrapper from the bundle digest", () => {
    const baseline = bundleDigestJson(bundleFixture.bundle);
    const mutated = structuredClone(bundleFixture.bundle) as Record<string, unknown>;
    mutated.runId = "ffffffff-0000-4000-8000-000000000000";
    mutated.contractVersion = 999;
    expect(bundleDigestJson(mutated)).toBe(baseline);
    delete mutated.runId;
    delete mutated.contractVersion;
    expect(bundleDigestJson(mutated)).toBe(baseline);
  });

  it("covers every logical bundle member in the bundle digest", () => {
    const baseline = bundleDigestJson(bundleFixture.bundle);
    const mutations: Record<string, unknown> = {
      definition: { id: "other" },
      arguments: { ticket: "PRO-999" },
      resolvedStages: [],
      resolvedPlacement: { kind: "newScratch" },
    };
    for (const [field, value] of Object.entries(mutations)) {
      const mutated = structuredClone(bundleFixture.bundle) as Record<string, unknown>;
      mutated[field] = value;
      expect(bundleDigestJson(mutated), field).not.toBe(baseline);
    }
  });

  it("rejects a bundle missing a digest-covered member", () => {
    const mutated = structuredClone(bundleFixture.bundle) as Record<string, unknown>;
    delete mutated.arguments;
    expect(() => bundleDigestJson(mutated)).toThrow(/digest-covered field 'arguments'/);
    expect(() => bundleDigestJson([])).toThrow(/plain JSON object/);
  });

  it("agrees with the golden runtime payload digest over only the run object", () => {
    expect(sha256HexOfText(runtimePayloadDigestJson(payloadFixture.payload))).toBe(
      payloadFixture.runtimePayloadDigest,
    );
    expect(sha256Hex(payloadFixture.payload.run)).toBe(
      payloadFixture.runtimePayloadDigest,
    );
  });

  it("excludes the data epoch and control from the runtime payload digest", () => {
    const baseline = runtimePayloadDigestJson(payloadFixture.payload);
    const mutated = structuredClone(payloadFixture.payload) as {
      expectedDataEpoch?: string;
      run: { placement: { kind: string } };
      control?: { cancelRequested: boolean };
    };
    mutated.expectedDataEpoch = "01J00000000000000000000000";
    mutated.control = { cancelRequested: false };
    expect(runtimePayloadDigestJson(mutated)).toBe(baseline);
    delete mutated.expectedDataEpoch;
    delete mutated.control;
    expect(runtimePayloadDigestJson(mutated)).toBe(baseline);
    // Mutating the run object itself must change the digest.
    mutated.run.placement.kind = "worktree";
    expect(runtimePayloadDigestJson(mutated)).not.toBe(baseline);
  });

  it("rejects a payload missing the run object", () => {
    expect(() => runtimePayloadDigestJson({ control: { cancelRequested: true } })).toThrow(
      /digest-covered 'run' object/,
    );
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

  it("rejects non-plain objects instead of canonicalizing them as {}", () => {
    class Widget {
      name = "w";
    }
    expect(() => canonicalJson(new Date(0))).toThrow(/non-plain object/);
    expect(() => canonicalJson(new Map([["a", 1]]))).toThrow(/non-plain object/);
    expect(() => canonicalJson(new Set([1]))).toThrow(/non-plain object/);
    expect(() => canonicalJson(new Widget())).toThrow(/non-plain object/);
    expect(() => canonicalJson({ nested: new Date(0) })).toThrow(/non-plain object/);
    // Null-prototype objects are plain JSON objects.
    const bare = Object.create(null) as Record<string, unknown>;
    bare.a = 1;
    expect(canonicalJson(bare)).toBe('{"a":1}');
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
