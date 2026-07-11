/**
 * T3-WF-MANIFEST-01 (WS10a):
 *   pnpm -C tests/release exec tsx --test src/runner/workflow-policy.test.ts
 *
 * Proves the strict release policy:
 *   - release mode fails on each bad required-row type
 *     (missing, duplicate result, blocked, skipped, expected-fail, cancelled, failed)
 *   - release mode passes only on exactly-all-green
 *   - signal mode preserves the current permissive behavior
 *   - manifest uniqueness validation
 *   - summary-artifact schema validation, including missing-digest failure
 *   - the no-retry-after-external-effect structural invariant
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_RELEASE_POLICY,
  ManifestConfigError,
  evaluate,
  loadRequiredManifest,
  parseReleasePolicy,
  requiredKey,
  validateManifest,
  type RequiredManifest,
  type ResultRow,
  type ScenarioStatus,
} from "./workflow-policy.js";
import {
  SUMMARY_ENV,
  SUMMARY_IDENTITY_FIELDS,
  UNKNOWN,
  buildSummary,
  summaryIdentityFromEnv,
  validateSummary,
} from "./summary-artifact.js";
import {
  RUNNER_RETRIES_AFTER_EXTERNAL_EFFECT,
  SCENARIO_DEADLINE_MS,
  ScenarioRunGuard,
  scenarioCorrelationId,
  withDeadline,
} from "./live-scenario-policy.js";

// A small, self-contained manifest so the tests do not depend on the seeded
// (WS10b-owned) content in required-workflows.json.
const MANIFEST: RequiredManifest = {
  version: 1,
  required: [
    { id: "T3-WF-1", lane: "cloud" },
    { id: "T3-WF-4", lane: "desktop" },
  ],
};

function allGreen(): ResultRow[] {
  return [
    { id: "T3-WF-1", lane: "cloud", status: "green" },
    { id: "T3-WF-4", lane: "desktop", status: "green" },
  ];
}

// --- release mode: exactly-all-green passes ---------------------------------

test("release mode passes only on exactly-all-green", () => {
  const evalResult = evaluate(MANIFEST, allGreen(), "release");
  assert.equal(evalResult.ok, true);
  assert.equal(evalResult.exitCode, 0);
  assert.deepEqual(evalResult.violations, []);
  assert.equal(evalResult.counters.missing, 0);
  assert.equal(evalResult.counters.failed, 0);
});

// --- release mode: each bad row type fails ----------------------------------

test("release mode fails on a MISSING required row", () => {
  const results: ResultRow[] = [{ id: "T3-WF-1", lane: "cloud", status: "green" }];
  const evalResult = evaluate(MANIFEST, results, "release");
  assert.equal(evalResult.ok, false);
  assert.equal(evalResult.exitCode, 1);
  assert.equal(evalResult.counters.missing, 1);
  assert.match(evalResult.violations.join("\n"), /T3-WF-4\/desktop: missing/);
});

test("release mode fails on a DUPLICATED result row", () => {
  const results: ResultRow[] = [
    { id: "T3-WF-1", lane: "cloud", status: "green" },
    { id: "T3-WF-1", lane: "cloud", status: "green" },
    { id: "T3-WF-4", lane: "desktop", status: "green" },
  ];
  const evalResult = evaluate(MANIFEST, results, "release");
  assert.equal(evalResult.ok, false);
  assert.equal(evalResult.exitCode, 1);
  assert.equal(evalResult.counters.duplicate, 1);
  assert.match(evalResult.violations.join("\n"), /T3-WF-1\/cloud: duplicate/);
});

for (const status of ["blocked", "skipped", "expected-fail", "cancelled", "failed"] as const) {
  test(`release mode fails on a ${status} required row`, () => {
    const results: ResultRow[] = [
      { id: "T3-WF-1", lane: "cloud", status: status as ScenarioStatus },
      { id: "T3-WF-4", lane: "desktop", status: "green" },
    ];
    const evalResult = evaluate(MANIFEST, results, "release");
    assert.equal(evalResult.ok, false, `${status} must fail release mode`);
    assert.equal(evalResult.exitCode, 1);
    assert.match(evalResult.violations.join("\n"), new RegExp(`T3-WF-1/cloud: ${status}`));
  });
}

test("release mode reports every bad row at once with correct counters", () => {
  const bigManifest: RequiredManifest = {
    version: 1,
    required: [
      { id: "A", lane: "cloud" },
      { id: "B", lane: "cloud" },
      { id: "C", lane: "cloud" },
      { id: "D", lane: "cloud" },
      { id: "E", lane: "cloud" },
      { id: "F", lane: "cloud" }, // missing
    ],
  };
  const results: ResultRow[] = [
    { id: "A", lane: "cloud", status: "blocked" },
    { id: "B", lane: "cloud", status: "skipped" },
    { id: "C", lane: "cloud", status: "expected-fail" },
    { id: "D", lane: "cloud", status: "cancelled" },
    { id: "E", lane: "cloud", status: "failed" },
  ];
  const evalResult = evaluate(bigManifest, results, "release");
  assert.equal(evalResult.ok, false);
  assert.deepEqual(evalResult.counters, {
    missing: 1,
    skipped: 1,
    blocked: 1,
    expectedFail: 1,
    cancelled: 1,
    duplicate: 0,
    failed: 1,
  });
});

test("release mode rejects a non-green emitted result outside the provisional manifest", () => {
  const results: ResultRow[] = [
    ...allGreen(),
    { id: "T3-BILL-1", lane: "cloud", status: "blocked" },
  ];
  const evalResult = evaluate(MANIFEST, results, "release");
  assert.equal(evalResult.ok, false);
  assert.equal(evalResult.exitCode, 1);
  assert.equal(evalResult.counters.blocked, 1);
  assert.match(evalResult.violations.join("\n"), /T3-BILL-1\/cloud: blocked/);
});

test("release mode rejects duplicate emitted results outside the provisional manifest", () => {
  const results: ResultRow[] = [
    ...allGreen(),
    { id: "T3-CHAT-1", lane: "cloud", status: "green" },
    { id: "T3-CHAT-1", lane: "cloud", status: "green" },
  ];
  const evalResult = evaluate(MANIFEST, results, "release");
  assert.equal(evalResult.ok, false);
  assert.equal(evalResult.counters.duplicate, 1);
  assert.match(evalResult.violations.join("\n"), /T3-CHAT-1\/cloud: duplicate/);
});

test("release mode accepts an additional unique green registered result", () => {
  const results: ResultRow[] = [
    ...allGreen(),
    { id: "T3-PROV-1", lane: "cloud", status: "green" },
  ];
  const evalResult = evaluate(MANIFEST, results, "release");
  assert.equal(evalResult.ok, true);
  assert.equal(evalResult.exitCode, 0);
  assert.deepEqual(evalResult.violations, []);
  assert.equal(evalResult.rows.at(-1)?.verdict, "green");
});

// --- signal mode: permissive ------------------------------------------------

test("signal mode preserves current permissive behavior (blocked/expected-fail/missing pass)", () => {
  const results: ResultRow[] = [
    { id: "T3-WF-1", lane: "cloud", status: "blocked" },
    // T3-WF-4/desktop missing entirely
  ];
  const evalResult = evaluate(MANIFEST, results, "signal");
  assert.equal(evalResult.ok, true);
  assert.equal(evalResult.exitCode, 0);
  // Counters are still computed for the informational report.
  assert.equal(evalResult.counters.blocked, 1);
  assert.equal(evalResult.counters.missing, 1);
});

test("signal mode is informational even when a required row failed", () => {
  const results: ResultRow[] = [
    { id: "T3-WF-1", lane: "cloud", status: "failed" },
    { id: "T3-WF-4", lane: "desktop", status: "green" },
  ];
  const evalResult = evaluate(MANIFEST, results, "signal");
  assert.equal(evalResult.ok, true);
  assert.equal(evalResult.exitCode, 0);
});

// --- manifest uniqueness validation -----------------------------------------

test("validateManifest flags a duplicate (id, lane) pair as a config error", () => {
  const errors = validateManifest({
    version: 1,
    required: [
      { id: "T3-WF-1", lane: "cloud" },
      { id: "T3-WF-1", lane: "cloud" },
    ],
  });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /duplicate required row T3-WF-1\/cloud/);
});

test("validateManifest allows the same id on distinct lanes", () => {
  const errors = validateManifest({
    version: 1,
    required: [
      { id: "T3-WF-4", lane: "cloud" },
      { id: "T3-WF-4", lane: "desktop" },
    ],
  });
  assert.deepEqual(errors, []);
});

test("validateManifest rejects empty id/lane and non-array required", () => {
  assert.ok(validateManifest({ version: 1, required: [{ id: "", lane: "cloud" }] }).length > 0);
  assert.ok(validateManifest({ version: 1, required: [{ id: "X", lane: "" }] }).length > 0);
  assert.ok(validateManifest({ version: 1, required: "nope" }).length > 0);
  assert.ok(validateManifest(null).length > 0);
});

test("evaluate throws ManifestConfigError on a non-unique manifest", () => {
  const bad: RequiredManifest = {
    version: 1,
    required: [
      { id: "T3-WF-1", lane: "cloud" },
      { id: "T3-WF-1", lane: "cloud" },
    ],
  };
  assert.throws(() => evaluate(bad, [], "release"), ManifestConfigError);
  // A bad manifest fails loudly even in signal mode.
  assert.throws(() => evaluate(bad, [], "signal"), ManifestConfigError);
});

test("the seeded required-workflows.json manifest is valid and unique", () => {
  const manifest = loadRequiredManifest();
  assert.deepEqual(validateManifest(manifest), []);
  assert.equal(manifest.required.length, 12);
  // Spot-check the plan's rows are present.
  const keys = new Set(manifest.required.map((r) => requiredKey(r)));
  assert.ok(keys.has("T3-WF-1/cloud"));
  assert.ok(keys.has("T3-WF-4/desktop"));
  assert.ok(keys.has("T3-WF-10/cloud"));
});

// --- policy parsing ---------------------------------------------------------

test("parseReleasePolicy defaults to signal and rejects unknown values", () => {
  assert.equal(parseReleasePolicy(undefined), DEFAULT_RELEASE_POLICY);
  assert.equal(parseReleasePolicy(""), "signal");
  assert.equal(parseReleasePolicy("release"), "release");
  assert.equal(parseReleasePolicy("signal"), "signal");
  assert.throws(() => parseReleasePolicy("strict"), /must be one of/);
});

// --- summary artifact schema validation -------------------------------------

function fullIdentityEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const field of SUMMARY_IDENTITY_FIELDS) {
    env[SUMMARY_ENV[field]] = `${field}-value`;
  }
  return env;
}

test("buildSummary matches the plan's field shape and passes release validation when fully populated", () => {
  const results = allGreen();
  const evalResult = evaluate(MANIFEST, results, "release");
  const summary = buildSummary({
    policy: "release",
    target: "staging",
    manifest: MANIFEST,
    results,
    evaluation: evalResult,
    env: fullIdentityEnv(),
  });
  // Shape: every field from the plan's example is present.
  assert.equal(summary.policy, "release");
  assert.equal(summary.target, "staging");
  assert.deepEqual(summary.required, ["T3-WF-1/cloud", "T3-WF-4/desktop"]);
  assert.equal(summary.results.length, 2);
  assert.equal(summary.missing, 0);
  assert.equal(summary.duplicate, 0);
  const validation = validateSummary(summary, "release");
  assert.equal(validation.ok, true, validation.errors.join("; "));
});

test("release validation FAILS when a digest field is unknown (missing env)", () => {
  const results = allGreen();
  const evalResult = evaluate(MANIFEST, results, "release");
  const env = fullIdentityEnv();
  delete env[SUMMARY_ENV.serverImageDigest]; // one missing digest
  const summary = buildSummary({
    policy: "release",
    target: "staging",
    manifest: MANIFEST,
    results,
    evaluation: evalResult,
    env,
  });
  assert.equal(summary.serverImageDigest, UNKNOWN);
  const validation = validateSummary(summary, "release");
  assert.equal(validation.ok, false);
  assert.match(validation.errors.join("\n"), /serverImageDigest/);
});

test("release validation FAILS when a non-green counter is nonzero", () => {
  const results: ResultRow[] = [
    { id: "T3-WF-1", lane: "cloud", status: "blocked" },
    { id: "T3-WF-4", lane: "desktop", status: "green" },
  ];
  const evalResult = evaluate(MANIFEST, results, "release");
  const summary = buildSummary({
    policy: "release",
    target: "staging",
    manifest: MANIFEST,
    results,
    evaluation: evalResult,
    env: fullIdentityEnv(),
  });
  const validation = validateSummary(summary, "release");
  assert.equal(validation.ok, false);
  assert.match(validation.errors.join("\n"), /counter `blocked`|not green/);
});

test("signal validation ignores unknown identity fields and non-green counters", () => {
  const results: ResultRow[] = [{ id: "T3-WF-1", lane: "cloud", status: "blocked" }];
  const evalResult = evaluate(MANIFEST, results, "signal");
  const summary = buildSummary({
    policy: "signal",
    target: "local",
    manifest: MANIFEST,
    results,
    evaluation: evalResult,
    env: {}, // all identity fields unknown
  });
  const validation = validateSummary(summary, "signal");
  assert.equal(validation.ok, true, validation.errors.join("; "));
});

test("summaryIdentityFromEnv defaults every absent field to UNKNOWN", () => {
  const identity = summaryIdentityFromEnv({});
  for (const field of SUMMARY_IDENTITY_FIELDS) {
    assert.equal(identity[field], UNKNOWN);
  }
});

// --- live-scenario policy: correlation, deadline, no-retry ------------------

test("scenarioCorrelationId is unique per run", () => {
  const a = scenarioCorrelationId("T3-WF-1", "cloud");
  const b = scenarioCorrelationId("T3-WF-1", "cloud");
  assert.notEqual(a, b);
  assert.match(a, /^T3-WF-1\/cloud\//);
});

test("the runner does not retry after an external effect (structural invariant)", () => {
  assert.equal(RUNNER_RETRIES_AFTER_EXTERNAL_EFFECT, false);
  const guard = new ScenarioRunGuard();
  guard.begin("T3-WF-1", "cloud");
  guard.begin("T3-WF-1", "desktop"); // distinct lane is fine
  assert.throws(() => guard.begin("T3-WF-1", "cloud"), /Refusing to retry/);
});

test("withDeadline rejects work that exceeds the deadline and resolves fast work", async () => {
  assert.ok(SCENARIO_DEADLINE_MS > 0);
  await assert.rejects(
    withDeadline(new Promise((resolve) => setTimeout(resolve, 50)), 5, "T3-WF-1/cloud"),
    /exceeded the 5ms scenario deadline/,
  );
  const value = await withDeadline(Promise.resolve("ok"), SCENARIO_DEADLINE_MS, "T3-WF-1/cloud");
  assert.equal(value, "ok");
});
