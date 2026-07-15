import assert from "node:assert/strict";
import { test } from "node:test";

import {
  sanitizeCellEvidence,
  sanitizeReportV4Evidence,
  type LocalWorkspaceTurnEvidenceV1,
  type TestRunReportV4,
  type Tier2BillingEvidenceV1,
} from "./schema.js";

function tier2Evidence(overrides: Partial<Tier2BillingEvidenceV1> = {}): Tier2BillingEvidenceV1 {
  return {
    kind: "tier2_billing",
    manifest_id: "T2-BILL-1",
    server_version: "1.2.3",
    billing_mode: "enforce",
    asserted_policy: { free_grant_usd: 2, compute_margin_multiplier: 1.5 },
    stripe: { test_clock_ids: ["tc_1"], object_ids: ["cus_1", "sub_1"] },
    ledger: {
      grants_delta: 1,
      seat_adjustments_delta: 0,
      usage_exports_delta: 0,
      llm_events_delta: 0,
      webhook_receipts_delta: 0,
      holds_delta: 0,
    },
    ...overrides,
  };
}

function localEvidence(): LocalWorkspaceTurnEvidenceV1 {
  return {
    kind: "local_workspace_turn",
    artifact_ids: ["server/linux-amd64"],
    server_version: "1.2.3",
    anyharness_version: "4.5.6",
    harness: "claude",
    model_id: "claude-haiku-4-5",
    workspace_id_hash: "a".repeat(64),
    session_id_hash: "b".repeat(64),
    transcript_reopened: true,
    litellm: {
      token_id_hash: "c".repeat(64),
      request_ids: ["req-1"],
      window_started_at: "2026-01-01T00:00:00.000Z",
      window_finished_at: "2026-01-01T00:00:01.000Z",
      prompt_tokens: 10,
      completion_tokens: 3,
      total_tokens: 13,
      spend_usd: 0.01,
    },
    cleanup: {
      ledger_id_hash: "d".repeat(64),
      registered: 1,
      reconciled: 1,
      failed: 0,
      virtual_key_deleted: true,
      litellm_subjects_deleted: true,
      browser_closed: true,
      processes_stopped: true,
      containers_removed: true,
      local_paths_removed: true,
    },
  };
}

test("sanitizeCellEvidence returns null unchanged", () => {
  assert.equal(sanitizeCellEvidence(null, ["s"]), null);
});

test("sanitizeCellEvidence tier2 branch redacts secrets in string fields and passes numbers through", () => {
  const secret = "sk_live_supersecret";
  const dirty = tier2Evidence({
    manifest_id: `T2-BILL-${secret}`,
    server_version: `1.2.3-${secret}`,
    stripe: { test_clock_ids: [`tc_${secret}`], object_ids: ["cus_1"] },
  });
  const clean = sanitizeCellEvidence(dirty, [secret]) as Tier2BillingEvidenceV1;
  assert.equal(clean.kind, "tier2_billing");
  assert.ok(clean.manifest_id.includes("[REDACTED]"));
  assert.ok(!clean.manifest_id.includes(secret));
  assert.ok(!clean.server_version.includes(secret));
  assert.ok(!clean.stripe.test_clock_ids[0].includes(secret));
  // Numeric evidence is untouched by sanitization.
  assert.deepEqual(clean.asserted_policy, { free_grant_usd: 2, compute_margin_multiplier: 1.5 });
  assert.deepEqual(clean.ledger, dirty.ledger);
  assert.deepEqual(clean.stripe.object_ids, ["cus_1"]);
});

test("sanitizeCellEvidence leaves the local_workspace_turn branch fully functional (dispatch regression guard)", () => {
  const secret = "token-secret";
  const dirty = localEvidence();
  dirty.model_id = `claude-haiku-${secret}`;
  const clean = sanitizeCellEvidence(dirty, [secret]) as LocalWorkspaceTurnEvidenceV1;
  assert.equal(clean.kind, "local_workspace_turn");
  assert.ok(clean.model_id.includes("[REDACTED]"));
  assert.equal(clean.litellm.request_ids[0], "req-1");
  assert.equal(clean.cleanup.failed, 0);
});

test("sanitizeReportV4Evidence maps sanitization across each result's evidence (tier2 and null)", () => {
  const secret = "whsec_secret";
  const report = {
    results: [
      { cell_id: "T2-BILL/local/case=T2-BILL-1", evidence: tier2Evidence({ manifest_id: `T2-BILL-${secret}` }) },
      { cell_id: "T2-BILL/local/case=T2-BILL-2", evidence: null },
    ],
  } as unknown as TestRunReportV4;
  const clean = sanitizeReportV4Evidence(report, [secret]);
  const first = clean.results[0].evidence as Tier2BillingEvidenceV1;
  assert.ok(first.manifest_id.includes("[REDACTED]"));
  assert.equal(clean.results[1].evidence, null);
});
