import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { runFoundation, type FoundationRunInput } from "./engine.js";
import { resolveManifestHash, availableCandidateSlots } from "./artifacts.js";
import { buildPlan, type CellSpec } from "./plan-builder.js";
import { createRunIdentity, createShardIdentity } from "./identity.js";
import { FileCleanupLedger } from "../ledger/file-ledger.js";
import { CleanupRunner } from "../ledger/reconcile.js";
import { JsonlEvidenceSink } from "../evidence/jsonl-sink.js";
import type { PreflightSource } from "../preflight/engine.js";
import { candidateManifest } from "../fakes/manifests.js";
import { FakeTier2Provisioner, fakeProvisioner, type FakeProvisionerOptions } from "../fakes/provisioners.js";
import { greenRunner, failingRunner } from "../fakes/cells.js";
import type { CellRunner } from "./cell.js";
import type { WorldId } from "../contracts/identity.js";
import type { WorldProvisioner } from "../contracts/world.js";
import type { SelectedCellPlan } from "../contracts/plan.js";

interface HarnessOptions {
  cells: CellSpec[];
  behavior: "diagnostic" | "strict";
  dryRun?: boolean;
  provisionerOptions?: FakeProvisionerOptions;
  registerProvisioner?: boolean;
  /** Build runners from the plan; default: one green runner per required cell. */
  runners?: (plan: SelectedCellPlan) => CellRunner[];
  preflightComplete?: boolean;
  provisioners?: ReadonlyMap<WorldId, WorldProvisioner>;
}

function harness(opts: HarnessOptions) {
  const dir = mkdtempSync(path.join(tmpdir(), "engine-"));
  const candidate = candidateManifest();
  const candidateManifestHash = resolveManifestHash(candidate);
  const run = createRunIdentity({
    sourceSha: candidate.sourceSha,
    candidateManifestHash,
    retainedManifestHash: null,
    env: {},
    hostname: "test",
    now: () => new Date("2026-07-13T00:00:00.000Z"),
    localNonce: "n",
  });
  const shard = createShardIdentity({ runId: run.runId, shardIndex: 1, shardCount: 1 });
  const fullPlan = buildPlan({ selector: "explicit", behavior: opts.behavior, cells: opts.cells });

  const provisioner = new FakeTier2Provisioner(opts.provisionerOptions);
  const provisioners =
    opts.provisioners ??
    (opts.registerProvisioner === false ? new Map() : new Map<WorldId, WorldProvisioner>([["tier-2", provisioner]]));

  const runners = opts.runners
    ? opts.runners(fullPlan)
    : fullPlan.cells.filter((c) => c.disposition === "required").map((c) => greenRunner(c.cell));

  const ledgerFile = path.join(dir, "cleanup.jsonl");
  const ledger = new CleanupRunner(new FileCleanupLedger(ledgerFile));
  const sink = new JsonlEvidenceSink(dir, run.runId, shard.shardId);

  const preflightSource: PreflightSource = {
    env: {},
    hostPlatform: "linux-x86_64",
    fileReadable: () => true,
    availableArtifactSlots:
      opts.preflightComplete === false ? new Set<string>() : availableCandidateSlots(candidate),
  };

  const input: FoundationRunInput = {
    run,
    shard,
    fullPlan,
    candidate,
    retained: null,
    provisioners,
    cellRunners: runners,
    preflightSource,
    ledger,
    evidence: sink,
    dryRun: opts.dryRun ?? false,
    now: () => new Date("2026-07-13T00:00:02.000Z").toISOString(),
  };

  return { dir, input, provisioner, sink, ledgerFile, fullPlan };
}

const tier2 = (id: string): CellSpec => ({ scenarioId: id, world: "tier-2" });

function cleanup(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

test("strict green: exactly one green per selected cell qualifies and emits evidence", async () => {
  const h = harness({ cells: [tier2("T2-AUTH-1"), tier2("T2-INV-1")], behavior: "strict" });
  const { evaluation, evidence } = await runFoundation(h.input);
  assert.equal(evaluation.verdict.qualifying, true);
  assert.equal(evidence.qualifying, true);
  assert.equal(h.provisioner.prepareCalls, 1, "world prepared once for both cells");
  assert.ok(existsSync(h.sink.evidencePath), "evidence emitted on success");
  cleanup(h.dir);
});

test("strict preflight incomplete performs ZERO provider mutation and emits blocked-preflight evidence", async () => {
  const h = harness({ cells: [tier2("T2-AUTH-1")], behavior: "strict", preflightComplete: false });
  const { evaluation } = await runFoundation(h.input);
  assert.equal(h.provisioner.prepareCalls, 0, "no provisioner.prepare when strict preflight is incomplete");
  assert.equal(evaluation.verdict.qualifying, false);
  const events = readFileSync(h.sink.eventsPath, "utf8");
  assert.match(events, /strict-preflight-blocked/);
  assert.ok(existsSync(h.sink.evidencePath), "evidence still emitted");
  cleanup(h.dir);
});

test("dry-run never provisions and never emits a green product result", async () => {
  const h = harness({ cells: [tier2("T2-AUTH-1")], behavior: "strict", dryRun: true });
  const { evidence, evaluation } = await runFoundation(h.input);
  assert.equal(h.provisioner.prepareCalls, 0, "dry-run does not provision");
  assert.equal(evidence.finals.length, 0, "no finals => no green product evidence");
  assert.equal(evidence.qualifying, false);
  assert.ok(evaluation.verdict.qualifying === false);
  cleanup(h.dir);
});

test("diagnostic is always non-qualifying even when every cell is green", async () => {
  const h = harness({ cells: [tier2("T2-AUTH-1")], behavior: "diagnostic" });
  const { evidence, evaluation } = await runFoundation(h.input);
  assert.equal(evidence.finals.every((f) => f.status === "green"), true);
  assert.equal(evaluation.verdict.qualifying, false, "diagnostic aggregate is never qualifying");
  cleanup(h.dir);
});

test("typed readiness refuses an incomplete world; cells are readiness_failed and evidence is emitted", async () => {
  const h = harness({
    cells: [tier2("T2-AUTH-1")],
    behavior: "strict",
    provisionerOptions: { incompleteReadiness: true },
  });
  const { evidence, evaluation } = await runFoundation(h.input);
  assert.equal(evidence.finals[0].status, "readiness_failed");
  assert.equal(evaluation.verdict.qualifying, false);
  assert.match(readFileSync(h.sink.eventsPath, "utf8"), /world-readiness-failed/);
  cleanup(h.dir);
});

test("typed readiness refuses an identity-mismatched world", async () => {
  const h = harness({
    cells: [tier2("T2-AUTH-1")],
    behavior: "strict",
    provisionerOptions: { mismatchRun: true },
  });
  const { evidence } = await runFoundation(h.input);
  assert.equal(evidence.finals[0].status, "readiness_failed");
  assert.match(evidence.finals[0].attempts[0].detail, /identity mismatch/);
  cleanup(h.dir);
});

test("a required cell with no collector produces a missing final result (rejected)", async () => {
  const h = harness({
    cells: [tier2("T2-AUTH-1"), tier2("T2-INV-1")],
    behavior: "strict",
    runners: (plan) => [greenRunner(plan.cells[0].cell)], // only the first cell has a collector
  });
  const { evaluation } = await runFoundation(h.input);
  assert.equal(evaluation.missingCellKeys.length, 1);
  assert.equal(evaluation.verdict.qualifying, false);
  cleanup(h.dir);
});

test("duplicate final results for one cell are rejected", async () => {
  const h = harness({
    cells: [tier2("T2-AUTH-1")],
    behavior: "strict",
    runners: (plan) => [greenRunner(plan.cells[0].cell), greenRunner(plan.cells[0].cell)],
  });
  const { evaluation } = await runFoundation(h.input);
  assert.equal(evaluation.duplicateCellKeys.length, 1);
  assert.equal(evaluation.verdict.qualifying, false);
  cleanup(h.dir);
});

test("assertion failure is recorded as failed, is non-qualifying, and emits evidence", async () => {
  const h = harness({
    cells: [tier2("T2-AUTH-1")],
    behavior: "strict",
    runners: (plan) => [failingRunner(plan.cells[0].cell, "expected 200 got 500")],
  });
  const { evidence, evaluation } = await runFoundation(h.input);
  assert.equal(evidence.finals[0].status, "failed");
  assert.equal(evaluation.verdict.qualifying, false);
  assert.ok(existsSync(h.sink.evidencePath));
  cleanup(h.dir);
});

test("cleanup failure keeps a strict run non-qualifying and still emits evidence", async () => {
  const h = harness({
    cells: [tier2("T2-AUTH-1")],
    behavior: "strict",
    provisionerOptions: {
      registerResource: { provider: "e2b", resourceType: "sandbox", resourceId: "sbx_leak" },
      cleanupThrows: true,
    },
  });
  const { evidence, evaluation } = await runFoundation(h.input);
  assert.equal(evidence.finals[0].status, "green", "the cell itself passed");
  assert.equal(evidence.cleanup.complete, false, "cleanup failed");
  assert.equal(evaluation.verdict.qualifying, false, "failed cleanup blocks qualification");
  // The resource was registered in the durable ledger before the world was used.
  assert.match(readFileSync(h.ledgerFile, "utf8"), /sbx_leak/);
  cleanup(h.dir);
});

test("registered run-scoped resource is cleaned on a successful strict run", async () => {
  const h = harness({
    cells: [tier2("T2-AUTH-1")],
    behavior: "strict",
    provisionerOptions: {
      registerResource: { provider: "e2b", resourceType: "sandbox", resourceId: "sbx_ok" },
    },
  });
  const { evidence } = await runFoundation(h.input);
  assert.equal(evidence.cleanup.complete, true);
  assert.equal(evidence.cleanup.cleaned, 1);
  assert.equal(evidence.qualifying, true);
  cleanup(h.dir);
});

test("legacy collectors cannot qualify even when green under strict", async () => {
  const h = harness({ cells: [{ scenarioId: "T3-GW-1", world: "local-runtime" }], behavior: "strict",
    provisioners: new Map<WorldId, WorldProvisioner>([["local-runtime", fakeProvisioner("local-runtime")]]),
    preflightComplete: true,
  });
  // Provide preflight satisfaction for local-runtime by widening available slots + env.
  (h.input.preflightSource as { availableArtifactSlots: ReadonlySet<string> }).availableArtifactSlots = new Set([
    "serverImage",
    "anyharness",
    "catalogHash",
    "registryHash",
    "litellm",
  ]);
  (h.input.preflightSource as { env: NodeJS.ProcessEnv }).env = {
    RELEASE_E2E_GATEWAY_TEST_KEY: "k",
    RELEASE_E2E_GATEWAY_BASE_URL: "https://gw.example.com",
  };
  const { evaluation } = await runFoundation(h.input);
  assert.equal(evaluation.verdict.qualifying, false, "a legacy cell selected as required cannot qualify");
  assert.ok(evaluation.verdict.qualifying === false);
  cleanup(h.dir);
});

test("a malformed candidate manifest is rejected before any provisioning", async () => {
  const h = harness({ cells: [tier2("T2-AUTH-1")], behavior: "strict" });
  // Corrupt the manifest after identity is fixed: hash no longer matches / invalid.
  const broken = { ...h.input, candidate: { ...h.input.candidate, sourceSha: "" } };
  await assert.rejects(() => runFoundation(broken), /missing sourceSha|hash mismatch/);
  assert.equal(h.provisioner.prepareCalls, 0, "no provisioning on a malformed manifest");
  cleanup(h.dir);
});
