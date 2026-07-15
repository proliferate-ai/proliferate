import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_TIER2_HARNESS_DEPS,
  TIER2_CASE_DIMENSION,
  makeTier2MatrixScenario,
  resolveServerVersion,
  runTier2Case,
  type Tier2HarnessDeps,
} from "./harness.js";
import { buildTier2BillingEvidence } from "./evidence.js";
import type {
  Tier2CaseResult,
  Tier2CellContext,
  Tier2CellHandler,
  Tier2ScenarioConfig,
} from "./types.js";
import type { Tier2BillingEvidenceV1 } from "../../evidence/schema.js";
import type { ScenarioPlanContext, ScenarioRunContext } from "../types.js";
import type { PlannedCellV1 } from "../../runner/result.js";
import type { BillingBootResult } from "../../../../intent/stack/billing-boot.ts";
import type { BootWithFakeResult, LitellmManagementFake } from "../../../../intent/stack/billing-usage-import.ts";
import type { BootedStack, StripeBillingEnv } from "../../../../intent/stack/boot.ts";

// The harness ignores the scenario run/plan context (its work is against the
// booted stack), so a bare cast is sufficient for these mechanism tests.
const RUN_CTX = {} as ScenarioRunContext;
const PLAN_CTX: ScenarioPlanContext = { runtimeLane: "local", desktop: "web", agents: ["claude"] };

const LEDGER_DELTA: Tier2BillingEvidenceV1["ledger"] = {
  grants_delta: 1,
  seat_adjustments_delta: 0,
  usage_exports_delta: 2,
  llm_events_delta: 0,
  webhook_receipts_delta: 1,
  holds_delta: 0,
};

interface HarnessLog {
  bootCalls: number;
  fakeBootCalls: number;
  fakeCloseCalls: number;
  clearEnvCalls: number;
  teardownCalls: number;
  resetCalls: number;
  ledgerBeginCalls: number;
  ledgerDeltaCalls: number;
  events: string[];
}

function fakeStripe(): StripeBillingEnv {
  return {
    secretKey: "sk_test_fake",
    webhookSecret: "whsec_fake",
    proMonthlyPriceId: "price_pro",
    overagePriceId: "price_overage",
    refillPriceId: "price_refill",
    meterId: "mtr_fake",
    billingMode: "enforce",
  };
}

function fakeStack(log: HarnessLog): BootedStack {
  return {
    profile: "t2billing",
    apiBaseUrl: "http://api.test",
    webBaseUrl: "http://web.test",
    anyharnessBaseUrl: "http://anyharness.test",
    databaseUrl: "postgresql://localhost:5432/t2billing",
    setupTokenFile: "/tmp/setup-token",
    teardown: async () => {
      log.teardownCalls += 1;
      log.events.push("teardown");
    },
  };
}

function fakeLitellmFake(log: HarnessLog): LitellmManagementFake {
  return {
    baseUrl: "http://fake-litellm.test",
    masterKey: "sk-fake-master",
    seedSpendRows: () => undefined,
    blockedKeys: () => [],
    mintedKeys: () => [],
    close: async () => {
      log.fakeCloseCalls += 1;
      log.events.push("fakeClose");
    },
  };
}

function makeDeps(
  opts: {
    boot?: (stack: BootedStack) => BillingBootResult;
    fakeBoot?: (stack: BootedStack) => BootWithFakeResult;
    ledgerProbeError?: Error;
  } = {},
): { deps: Tier2HarnessDeps; log: HarnessLog } {
  const log: HarnessLog = {
    bootCalls: 0,
    fakeBootCalls: 0,
    fakeCloseCalls: 0,
    clearEnvCalls: 0,
    teardownCalls: 0,
    resetCalls: 0,
    ledgerBeginCalls: 0,
    ledgerDeltaCalls: 0,
    events: [],
  };
  const stack = fakeStack(log);
  const boot: BillingBootResult = opts.boot ? opts.boot(stack) : { skipped: false, stack, stripe: fakeStripe() };
  const fakeBoot: BootWithFakeResult = opts.fakeBoot
    ? opts.fakeBoot(stack)
    : { skipped: false, stack, stripe: fakeStripe(), fake: fakeLitellmFake(log) };
  const deps: Tier2HarnessDeps = {
    bootBillingStack: async () => {
      log.bootCalls += 1;
      log.events.push("boot");
      return boot;
    },
    bootBillingStackWithLitellmFake: async () => {
      log.fakeBootCalls += 1;
      log.events.push("fakeBoot");
      return fakeBoot;
    },
    clearPublishedGatewayEnv: () => {
      log.clearEnvCalls += 1;
      log.events.push("clearEnv");
    },
    resetBillingState: async () => {
      log.resetCalls += 1;
      log.events.push("reset");
    },
    createLedgerProbe: () => {
      if (opts.ledgerProbeError) {
        throw opts.ledgerProbeError;
      }
      return {
        begin: async () => {
          log.ledgerBeginCalls += 1;
          log.events.push("ledger.begin");
        },
        delta: async () => {
          log.ledgerDeltaCalls += 1;
          log.events.push("ledger.delta");
          return { ...LEDGER_DELTA };
        },
      };
    },
    // Real (pure) assembler so the test exercises actual evidence construction.
    buildEvidence: buildTier2BillingEvidence,
    resolveServerVersion: () => "9.9.9-test",
    resolveBillingMode: () => "enforce",
  };
  return { deps, log };
}

function fakeCell(caseId: string): PlannedCellV1 {
  return {
    cell_id: `T2-BILL/local/${TIER2_CASE_DIMENSION}=${caseId}`,
    scenario_id: "T2-BILL",
    registry_flow_ref: "specs/developing/testing/flows.md#tier2-billing",
    runtime_lane: "local",
    dimensions: { [TIER2_CASE_DIMENSION]: caseId },
    required_env: [],
  };
}

function fakeConfig(cases: Record<string, Tier2CellHandler>): Tier2ScenarioConfig {
  return {
    id: "T2-BILL",
    title: "Tier-2 billing mechanism test",
    registryFlowRef: "specs/developing/testing/flows.md#tier2-billing",
    requiredEnv: ["TIER2_BILLING_STRIPE_SECRET_KEY"],
    requireStripe: true,
    cases,
  };
}

const greenHandler: Tier2CellHandler = async (ctx: Tier2CellContext): Promise<Tier2CaseResult> => {
  ctx.policy.record({ free_grant_usd: 2, llm_per_seat_usd: 5 });
  // Deliberately out of order + duplicated: evidence assembly must sort/dedup.
  ctx.ids.addObject("sub_2");
  ctx.ids.addObject("cus_1");
  ctx.ids.addObject("sub_2");
  ctx.ids.addTestClock("tc_9");
  return { status: "green" };
};

function eventHandler(_caseId: string, result: Tier2CaseResult): Tier2CellHandler {
  return async (): Promise<Tier2CaseResult> => result;
}

test("scenario definition is a matrix on lane local only (no new lane) and carries requiredEnv", () => {
  const scenario = makeTier2MatrixScenario(fakeConfig({ "T2-BILL-1": greenHandler }), makeDeps().deps);
  assert.equal(scenario.id, "T2-BILL");
  assert.equal(scenario.kind, "matrix");
  assert.deepEqual([...scenario.lanes], ["local"]);
  assert.deepEqual([...scenario.requiredEnv], ["TIER2_BILLING_STRIPE_SECRET_KEY"]);
});

test("expandCells emits exactly one spec per case, carrying the case dimension", async () => {
  const scenario = makeTier2MatrixScenario(
    fakeConfig({ "T2-BILL-1": greenHandler, "T2-BILL-2": greenHandler }),
    makeDeps().deps,
  );
  const specs = await scenario.expandCells(PLAN_CTX);
  assert.deepEqual(specs, [
    { dimensions: { case: "T2-BILL-1" } },
    { dimensions: { case: "T2-BILL-2" } },
  ]);
});

test("planCell prefixes every step with the cell id and mentions the case", () => {
  const scenario = makeTier2MatrixScenario(fakeConfig({ "T2-BILL-1": greenHandler }), makeDeps().deps);
  const cell = fakeCell("T2-BILL-1");
  const steps = scenario.planCell(PLAN_CTX, cell);
  assert.ok(steps.length >= 3);
  for (const step of steps) {
    assert.ok(step.description.startsWith(`[${cell.cell_id}]`));
  }
  assert.ok(steps.some((step) => step.description.includes("T2-BILL-1")));
});

test("a green case yields one green outcome with tier2_billing evidence, in reset→begin→handler→delta order", async () => {
  const { deps, log } = makeDeps();
  const scenario = makeTier2MatrixScenario(fakeConfig({ "T2-BILL-1": greenHandler }), deps);
  const outcomes = await scenario.runCells(RUN_CTX, [fakeCell("T2-BILL-1")]);

  assert.equal(outcomes.length, 1);
  const [outcome] = outcomes;
  assert.equal(outcome.cellId, "T2-BILL/local/case=T2-BILL-1");
  assert.equal(outcome.status, "green");
  assert.ok(outcome.evidence);
  const evidence = outcome.evidence as Tier2BillingEvidenceV1;
  assert.equal(evidence.kind, "tier2_billing");
  assert.equal(evidence.manifest_id, "T2-BILL-1");
  assert.equal(evidence.server_version, "9.9.9-test");
  assert.equal(evidence.billing_mode, "enforce");
  assert.deepEqual(evidence.asserted_policy, { free_grant_usd: 2, llm_per_seat_usd: 5 });
  assert.deepEqual(evidence.ledger, LEDGER_DELTA);
  // Ids sorted ascending + de-duplicated by the assembler.
  assert.deepEqual(evidence.stripe.object_ids, ["cus_1", "sub_2"]);
  assert.deepEqual(evidence.stripe.test_clock_ids, ["tc_9"]);

  assert.deepEqual(log.events, ["boot", "reset", "ledger.begin", "ledger.delta", "teardown"]);
  assert.equal(log.bootCalls, 1);
  assert.equal(log.teardownCalls, 1);
});

test("a failed case yields a failed outcome with the handler reason and NO evidence", async () => {
  const { deps, log } = makeDeps();
  const scenario = makeTier2MatrixScenario(
    fakeConfig({ "T2-BILL-1": eventHandler("T2-BILL-1", { status: "failed", reason: "assertion x != y" }) }),
    deps,
  );
  const [outcome] = await scenario.runCells(RUN_CTX, [fakeCell("T2-BILL-1")]);
  assert.equal(outcome.status, "failed");
  assert.equal(outcome.reason?.code, "scenario_failure");
  assert.equal(outcome.reason?.message, "assertion x != y");
  assert.equal(outcome.evidence, undefined);
  // Delta is never computed for a non-green case; the stack is still torn down.
  assert.equal(log.ledgerDeltaCalls, 0);
  assert.equal(log.teardownCalls, 1);
});

test("blocked and expected_fail map to their reason codes and carry no evidence", async () => {
  const { deps } = makeDeps();
  const scenario = makeTier2MatrixScenario(
    fakeConfig({
      "T2-BILL-1": eventHandler("T2-BILL-1", { status: "blocked", reason: "no Stripe test clock" }),
      "T2-BILL-2": eventHandler("T2-BILL-2", { status: "expected_fail", reason: "known dunning gap" }),
    }),
    deps,
  );
  const outcomes = await scenario.runCells(RUN_CTX, [fakeCell("T2-BILL-1"), fakeCell("T2-BILL-2")]);
  const blocked = outcomes.find((o) => o.cellId.endsWith("T2-BILL-1"))!;
  const expectedFail = outcomes.find((o) => o.cellId.endsWith("T2-BILL-2"))!;
  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.reason?.code, "scenario_blocked");
  assert.equal(blocked.evidence, undefined);
  assert.equal(expectedFail.status, "expected_fail");
  assert.equal(expectedFail.reason?.code, "known_gap");
  assert.equal(expectedFail.evidence, undefined);
});

test("a handler that throws is caught as a failed outcome (never green), stack still torn down", async () => {
  const { deps, log } = makeDeps();
  const throwing: Tier2CellHandler = async () => {
    throw new Error("boom in the case body");
  };
  const scenario = makeTier2MatrixScenario(fakeConfig({ "T2-BILL-1": throwing }), deps);
  const [outcome] = await scenario.runCells(RUN_CTX, [fakeCell("T2-BILL-1")]);
  assert.equal(outcome.status, "failed");
  assert.equal(outcome.reason?.code, "scenario_failure");
  assert.match(outcome.reason?.message ?? "", /boom in the case body/);
  assert.equal(outcome.evidence, undefined);
  assert.equal(log.teardownCalls, 1);
});

test("when boot is skipped every assigned cell is blocked — never green, stack never booted/torn down", async () => {
  const { deps, log } = makeDeps({ boot: () => ({ skipped: true, reason: "no Stripe test key resolvable" }) });
  const scenario = makeTier2MatrixScenario(
    fakeConfig({ "T2-BILL-1": greenHandler, "T2-BILL-2": greenHandler }),
    deps,
  );
  const outcomes = await scenario.runCells(RUN_CTX, [fakeCell("T2-BILL-1"), fakeCell("T2-BILL-2")]);
  assert.equal(outcomes.length, 2);
  for (const outcome of outcomes) {
    assert.equal(outcome.status, "blocked");
    assert.equal(outcome.reason?.code, "scenario_blocked");
    assert.match(outcome.reason?.message ?? "", /no Stripe test key resolvable/);
    assert.equal(outcome.evidence, undefined);
  }
  assert.equal(log.bootCalls, 1);
  assert.equal(log.teardownCalls, 0);
  assert.equal(log.resetCalls, 0);
});

test("a cell whose case has no registered handler fails (never green, never missing-as-green)", async () => {
  const { deps } = makeDeps();
  const scenario = makeTier2MatrixScenario(fakeConfig({ "T2-BILL-1": greenHandler }), deps);
  const [outcome] = await scenario.runCells(RUN_CTX, [fakeCell("T2-BILL-99")]);
  assert.equal(outcome.status, "failed");
  assert.equal(outcome.reason?.code, "scenario_failure");
  assert.match(outcome.reason?.message ?? "", /no handler registered for Tier-2 case "T2-BILL-99"/);
});

test("multiple assigned cells produce exactly one outcome each, order preserved, booted once", async () => {
  const { deps, log } = makeDeps();
  const scenario = makeTier2MatrixScenario(
    fakeConfig({
      "T2-BILL-1": greenHandler,
      "T2-BILL-2": eventHandler("T2-BILL-2", { status: "failed", reason: "x" }),
      "T2-BILL-3": greenHandler,
    }),
    deps,
  );
  const outcomes = await scenario.runCells(RUN_CTX, [
    fakeCell("T2-BILL-1"),
    fakeCell("T2-BILL-2"),
    fakeCell("T2-BILL-3"),
  ]);
  assert.deepEqual(
    outcomes.map((o) => o.cellId),
    ["T2-BILL/local/case=T2-BILL-1", "T2-BILL/local/case=T2-BILL-2", "T2-BILL/local/case=T2-BILL-3"],
  );
  assert.deepEqual(
    outcomes.map((o) => o.status),
    ["green", "failed", "green"],
  );
  assert.equal(log.bootCalls, 1);
  assert.equal(log.teardownCalls, 1);
  assert.equal(log.resetCalls, 3);
});

test("an unexpected error inside the run loop still tears the stack down (finally) and propagates", async () => {
  const { deps, log } = makeDeps({ ledgerProbeError: new Error("probe init failed") });
  const scenario = makeTier2MatrixScenario(fakeConfig({ "T2-BILL-1": greenHandler }), deps);
  await assert.rejects(() => scenario.runCells(RUN_CTX, [fakeCell("T2-BILL-1")]), /probe init failed/);
  assert.equal(log.teardownCalls, 1);
});

test("runTier2Case builds evidence from the recorded policy, deltas, and safe ids on green", async () => {
  const { deps } = makeDeps();
  const outcome = await runTier2Case(
    fakeConfig({ "T2-BILL-1": greenHandler }),
    fakeCell("T2-BILL-1"),
    fakeStack({
      bootCalls: 0,
      fakeBootCalls: 0,
      fakeCloseCalls: 0,
      clearEnvCalls: 0,
      teardownCalls: 0,
      resetCalls: 0,
      ledgerBeginCalls: 0,
      ledgerDeltaCalls: 0,
      events: [],
    }),
    fakeStripe(),
    deps,
  );
  assert.equal(outcome.status, "green");
  const evidence = outcome.evidence as Tier2BillingEvidenceV1;
  assert.equal(evidence.manifest_id, "T2-BILL-1");
  assert.deepEqual(evidence.stripe.object_ids, ["cus_1", "sub_2"]);
});

test("DEFAULT_TIER2_HARNESS_DEPS wires the real resolvers and the real evidence assembler", () => {
  assert.equal(typeof DEFAULT_TIER2_HARNESS_DEPS.bootBillingStack, "function");
  assert.equal(typeof DEFAULT_TIER2_HARNESS_DEPS.bootBillingStackWithLitellmFake, "function");
  assert.equal(typeof DEFAULT_TIER2_HARNESS_DEPS.clearPublishedGatewayEnv, "function");
  assert.equal(DEFAULT_TIER2_HARNESS_DEPS.buildEvidence, buildTier2BillingEvidence);
  assert.equal(DEFAULT_TIER2_HARNESS_DEPS.resolveServerVersion, resolveServerVersion);
});

function gatewayFakeConfig(cases: Record<string, Tier2CellHandler>): Tier2ScenarioConfig {
  return { ...fakeConfig(cases), gatewayFake: true };
}

test("gatewayFake config boots via the LiteLLM-fake path, NOT the plain boot, and closes the fake + clears gateway env at teardown", async () => {
  const { deps, log } = makeDeps();
  const scenario = makeTier2MatrixScenario(gatewayFakeConfig({ "T2-BILL-1": greenHandler }), deps);
  const [outcome] = await scenario.runCells(RUN_CTX, [fakeCell("T2-BILL-1")]);

  assert.equal(outcome.status, "green");
  // The fake boot path is taken; the plain boot is never called.
  assert.equal(log.fakeBootCalls, 1);
  assert.equal(log.bootCalls, 0);
  // Teardown folds stack teardown + fake close + gateway-env cleanup.
  assert.equal(log.teardownCalls, 1);
  assert.equal(log.fakeCloseCalls, 1);
  assert.equal(log.clearEnvCalls, 1);
  assert.deepEqual(log.events, [
    "fakeBoot",
    "reset",
    "ledger.begin",
    "ledger.delta",
    "teardown",
    "fakeClose",
    "clearEnv",
  ]);
});

test("gatewayFake config with a skipped fake boot blocks every cell (never green), fake never closed", async () => {
  const { deps, log } = makeDeps({ fakeBoot: () => ({ skipped: true, reason: "no Stripe test key resolvable" }) });
  const scenario = makeTier2MatrixScenario(gatewayFakeConfig({ "T2-BILL-1": greenHandler }), deps);
  const outcomes = await scenario.runCells(RUN_CTX, [fakeCell("T2-BILL-1")]);
  assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0].status, "blocked");
  assert.equal(outcomes[0].reason?.code, "scenario_blocked");
  assert.match(outcomes[0].reason?.message ?? "", /no Stripe test key resolvable/);
  assert.equal(log.fakeBootCalls, 1);
  assert.equal(log.bootCalls, 0);
  assert.equal(log.fakeCloseCalls, 0);
  assert.equal(log.clearEnvCalls, 0);
});
