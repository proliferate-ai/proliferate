import assert from "node:assert/strict";
import { test } from "node:test";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { evaluateRun } from "../../contracts/evaluate.js";
import type { SelectedCellPlan } from "../../contracts/plan.js";
import { cellKey, type CellIdentity } from "../../contracts/identity.js";
import type { FinalCellResult } from "../../contracts/results.js";
import { buildTier2StripePreflight, resolveStripeTestSecretKey, type StripeKeyResolution } from "./secret-preflight.js";

const BILLING_CELL: CellIdentity = {
  scenarioId: "T2-BILL-1",
  world: "tier-2",
  productHost: "desktop-web",
  dimensions: { slice: "checkout-to-grant" },
};
const BILLING_CELL_KEY = cellKey(BILLING_CELL);

function planFor(behavior: "diagnostic" | "strict"): SelectedCellPlan {
  return {
    selector: "explicit",
    behavior,
    worlds: ["tier-2"],
    cells: [{ cell: BILLING_CELL, cellKey: BILLING_CELL_KEY, disposition: "required", legacy: false }],
    deferredScenarioIds: [],
  };
}

// ── buildTier2StripePreflight: pure preflight-report shape ──

test("buildTier2StripePreflight: a FAKE missing resolution blocks the billing cell and is not complete", () => {
  const fakeMissing: StripeKeyResolution = { status: "missing", detail: "fake: no key anywhere", secretKey: null };
  const report = buildTier2StripePreflight([BILLING_CELL_KEY], fakeMissing);
  assert.equal(report.complete, false);
  assert.deepEqual(report.blockedCellKeys, [BILLING_CELL_KEY]);
  assert.equal(report.results[0].status, "missing");
  // Never leaks anything resembling an actual secret value (the shape
  // descriptor "sk_test_prefix" is a label, not a key, so it's excluded).
  assert.doesNotMatch(JSON.stringify(report), /sk_test_[A-Za-z0-9]{10,}/);
});

test("buildTier2StripePreflight: a FAKE malformed resolution also blocks and is not complete", () => {
  const fakeMalformed: StripeKeyResolution = { status: "malformed", detail: "fake: live-mode-shaped key", secretKey: null };
  const report = buildTier2StripePreflight([BILLING_CELL_KEY], fakeMalformed);
  assert.equal(report.complete, false);
  assert.deepEqual(report.blockedCellKeys, [BILLING_CELL_KEY]);
});

test("buildTier2StripePreflight: a FAKE satisfied resolution is complete and blocks nothing", () => {
  const fakeSatisfied: StripeKeyResolution = { status: "satisfied", detail: "fake: present", secretKey: "sk_test_fake" };
  const report = buildTier2StripePreflight([BILLING_CELL_KEY], fakeSatisfied);
  assert.equal(report.complete, true);
  assert.deepEqual(report.blockedCellKeys, []);
});

// ── The two result-behavior paths (evaluate.ts is the frozen, one true
// pass/fail rule — these tests feed it exactly what a real run would produce
// for each path, using a FAKE preflight so the real environment/CLI never
// needs to be touched). ──

test("diagnostic path: Stripe absent -> the cell reports blocked, run continues, but evidence is always nonqualifying", () => {
  const fakeMissing: StripeKeyResolution = { status: "missing", detail: "fake: no key anywhere", secretKey: null };
  const preflight = buildTier2StripePreflight([BILLING_CELL_KEY], fakeMissing);
  // What the T2-BILL-1 cell itself returns when handle.stripe is null
  // (see cells/t2-bill-1.ts): one final "blocked" result, not silently
  // dropped and not a fabricated "green".
  const blockedFinal: FinalCellResult = {
    cellKey: BILLING_CELL_KEY,
    cell: BILLING_CELL,
    status: "blocked",
    attempts: [],
  };
  const evaluation = evaluateRun({
    plan: planFor("diagnostic"),
    preflight,
    finals: [blockedFinal],
    cleanup: { attempted: 1, cleaned: 1, alreadyAbsent: 0, failed: [], complete: true },
    dryRun: false,
  });
  assert.equal(evaluation.verdict.qualifying, false);
  assert.equal(evaluation.nonGreenCellKeys.includes(BILLING_CELL_KEY), true);
  if (!evaluation.verdict.qualifying) {
    assert.ok(evaluation.verdict.reasons.some((r) => r.includes("diagnostic evidence is always nonqualifying")));
  }
});

test("strict path: Stripe absent -> preflight incomplete fails the run BEFORE the cell is even attempted (no green escape)", () => {
  const fakeMissing: StripeKeyResolution = { status: "missing", detail: "fake: no key anywhere", secretKey: null };
  const preflight = buildTier2StripePreflight([BILLING_CELL_KEY], fakeMissing);
  // Strict "fails before any external mutation" — the cell is never run, so
  // there is no final result for it at all.
  const evaluation = evaluateRun({
    plan: planFor("strict"),
    preflight,
    finals: [],
    cleanup: { attempted: 0, cleaned: 0, alreadyAbsent: 0, failed: [], complete: true },
    dryRun: false,
  });
  assert.equal(evaluation.verdict.qualifying, false);
  if (!evaluation.verdict.qualifying) {
    assert.ok(evaluation.verdict.reasons.some((r) => r.includes("strict preflight incomplete")));
  }
  assert.deepEqual(evaluation.missingCellKeys, [BILLING_CELL_KEY]);
});

test("strict path: Stripe present (FAKE satisfied) and the cell goes green -> the run qualifies", () => {
  const fakeSatisfied: StripeKeyResolution = { status: "satisfied", detail: "fake: present", secretKey: "sk_test_fake" };
  const preflight = buildTier2StripePreflight([BILLING_CELL_KEY], fakeSatisfied);
  const greenFinal: FinalCellResult = {
    cellKey: BILLING_CELL_KEY,
    cell: BILLING_CELL,
    status: "green",
    attempts: [
      {
        attemptId: "fake-attempt",
        attemptNumber: 1,
        cellKey: BILLING_CELL_KEY,
        cell: BILLING_CELL,
        status: "green",
        detail: "fake: real Stripe test-mode checkout issued a pro_period grant",
        correlationIds: [],
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        superseded: false,
      },
    ],
  };
  const evaluation = evaluateRun({
    plan: planFor("strict"),
    preflight,
    finals: [greenFinal],
    cleanup: { attempted: 1, cleaned: 1, alreadyAbsent: 0, failed: [], complete: true },
    dryRun: false,
  });
  assert.equal(evaluation.verdict.qualifying, true);
});

// ── resolveStripeTestSecretKey: real resolution logic, injected env/file so
// no real credential or CLI call is needed to test the branching. ──

test("resolveStripeTestSecretKey: ambient env wins and is validated for the sk_test_ shape", () => {
  const result = resolveStripeTestSecretKey({ STRIPE_SECRET_KEY: "sk_test_abc123" }, "/nonexistent/release-e2e.env");
  assert.equal(result.status, "satisfied");
  assert.equal(result.secretKey, "sk_test_abc123");
  assert.doesNotMatch(result.detail, /sk_test_abc123/);
});

test("resolveStripeTestSecretKey: a live-mode-shaped ambient key is malformed, not satisfied", () => {
  const result = resolveStripeTestSecretKey({ STRIPE_SECRET_KEY: "sk_live_abc123" }, "/nonexistent/release-e2e.env");
  assert.equal(result.status, "malformed");
  assert.equal(result.secretKey, null);
});

test("resolveStripeTestSecretKey: falls back to release-e2e.env parsed as data when env is empty", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "tf-tier2-release-e2e-"));
  const envFile = path.join(dir, "release-e2e.env");
  writeFileSync(envFile, "export STRIPE_SECRET_KEY=sk_test_from_file\n");
  const result = resolveStripeTestSecretKey({}, envFile);
  assert.equal(result.status, "satisfied");
  assert.equal(result.secretKey, "sk_test_from_file");
});

test("resolveStripeTestSecretKey: missing everywhere (no ambient env, no file, real CLI absent) is reported missing, never satisfied", () => {
  // PATH is emptied so a real `stripe` binary, even if installed on this
  // machine, cannot be found — proves the "missing" branch without depending
  // on whether the developer happens to have the CLI configured.
  const result = resolveStripeTestSecretKey({ PATH: "" }, "/nonexistent/release-e2e.env");
  assert.equal(result.status, "missing");
  assert.equal(result.secretKey, null);
});
