import { test } from "node:test";
import assert from "node:assert/strict";

import { runPreflight, deriveRequirements, checkRequirement, type PreflightSource } from "./engine.js";
import type { CapabilityRequirement } from "../contracts/preflight.js";
import { buildPlan } from "../runner/plan-builder.js";

function source(overrides: Partial<PreflightSource> = {}): PreflightSource {
  return {
    env: {},
    hostPlatform: "linux-x86_64",
    fileReadable: () => false,
    availableArtifactSlots: new Set<string>(),
    ...overrides,
  };
}

test("env-var shape checks are value-free and never echo the value", () => {
  const secret = "sk_test_abc123def456";
  const req: CapabilityRequirement = {
    kind: "env-var",
    name: "STRIPE_TEST_SECRET_KEY",
    shape: "sk_test_prefix",
    requiredByCellKeys: ["tier-2/T2-BILL-1/-/-"],
  };
  const ok = checkRequirement(req, source({ env: { STRIPE_TEST_SECRET_KEY: secret } }));
  assert.equal(ok.status, "satisfied");
  assert.ok(!ok.detail.includes(secret), "detail must not echo the value");
  assert.match(ok.detail, /chars/);

  const bad = checkRequirement(req, source({ env: { STRIPE_TEST_SECRET_KEY: "sk_live_nope" } }));
  assert.equal(bad.status, "malformed");
  assert.ok(!bad.detail.includes("sk_live_nope"));

  const missing = checkRequirement(req, source({ env: {} }));
  assert.equal(missing.status, "missing");
});

test("public_https_url rejects localhost and non-https", () => {
  const req: CapabilityRequirement = { kind: "env-var", name: "URL", shape: "public_https_url", requiredByCellKeys: ["c"] };
  assert.equal(checkRequirement(req, source({ env: { URL: "https://gw.example.com" } })).status, "satisfied");
  assert.equal(checkRequirement(req, source({ env: { URL: "http://gw.example.com" } })).status, "malformed");
  assert.equal(checkRequirement(req, source({ env: { URL: "https://localhost:8000" } })).status, "malformed");
  assert.equal(checkRequirement(req, source({ env: { URL: "https://127.0.0.1" } })).status, "malformed");
});

test("host-platform and artifact-slot requirements", () => {
  const host: CapabilityRequirement = { kind: "host-platform", name: "darwin", shape: null, requiredByCellKeys: ["c"] };
  assert.equal(checkRequirement(host, source({ hostPlatform: "darwin-aarch64" })).status, "satisfied");
  assert.equal(checkRequirement(host, source({ hostPlatform: "linux-x86_64" })).status, "missing");

  const slot: CapabilityRequirement = { kind: "artifact-slot", name: "e2bTemplate", shape: null, requiredByCellKeys: ["c"] };
  assert.equal(checkRequirement(slot, source({ availableArtifactSlots: new Set(["e2bTemplate"]) })).status, "satisfied");
  assert.equal(checkRequirement(slot, source()).status, "missing");
});

test("runPreflight blocks exactly the cells whose requirement is unsatisfied", () => {
  const reqs: CapabilityRequirement[] = [
    { kind: "env-var", name: "PRESENT", shape: "non_empty", requiredByCellKeys: ["cellA"] },
    { kind: "env-var", name: "ABSENT", shape: "non_empty", requiredByCellKeys: ["cellB", "cellC"] },
  ];
  const report = runPreflight(reqs, source({ env: { PRESENT: "x" } }));
  assert.equal(report.complete, false);
  assert.deepEqual(report.blockedCellKeys, ["cellB", "cellC"]);
});

test("a fully satisfied selected-cell set is complete with no blocked cells", () => {
  const reqs: CapabilityRequirement[] = [
    { kind: "env-var", name: "A", shape: "non_empty", requiredByCellKeys: ["cellA"] },
  ];
  const report = runPreflight(reqs, source({ env: { A: "1" } }));
  assert.equal(report.complete, true);
  assert.deepEqual(report.blockedCellKeys, []);
});

test("deriveRequirements attributes managed-cloud + billing requirements to the right cells", () => {
  const plan = buildPlan({
    selector: "explicit",
    behavior: "strict",
    cells: [
      { scenarioId: "CLOUD-PROVISION-1", world: "managed-cloud" },
      { scenarioId: "T3-BILL-1", world: "managed-cloud" },
    ],
  });
  const reqs = deriveRequirements(plan);
  const e2b = reqs.find((r) => r.name === "E2B_API_KEY");
  assert.ok(e2b, "managed-cloud requires E2B key");
  assert.equal(e2b?.requiredByCellKeys.length, 2, "both cloud cells need E2B");
  const stripe = reqs.find((r) => r.name === "STRIPE_TEST_SECRET_KEY");
  assert.ok(stripe, "the billing cell adds a Stripe requirement");
  assert.deepEqual(
    stripe?.requiredByCellKeys,
    plan.cells.filter((c) => c.cell.scenarioId === "T3-BILL-1").map((c) => c.cellKey),
  );
});

test("deriveRequirements ignores not_required cells", () => {
  const plan = buildPlan({
    selector: "explicit",
    behavior: "strict",
    cells: [{ scenarioId: "T2-AUTH-1", world: "tier-2", disposition: "not_required" }],
  });
  assert.deepEqual(deriveRequirements(plan), []);
});
